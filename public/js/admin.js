import { api, linkPath } from "./api.js";
import { copyButton } from "./copy.js";
import { renderDetail, statusTag } from "./detail.js";
import { clear, h } from "./dom.js";
import { displayUrl, formatCount, formatDate, fromLocalInput } from "./format.js";
import { toast } from "./toast.js";

const SLUG = /^[A-Za-z0-9_-]{1,64}$/;
const WIDE = matchMedia("(min-width: 64rem)");
const main = document.getElementById("main");

const state = { links: [], query: "", selected: null, loaded: false };
const pendingDeletes = new Map();

const byNewest = (a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.slug.localeCompare(b.slug));

const signInHref = () => `/auth/github?next=${encodeURIComponent("/admin")}`;

const gate = (title, message, ...actions) =>
  clear(main).append(h("section", { class: "gate card" }, h("h1", { class: "gate__title" }, title), h("p", { class: "muted" }, message), h("div", { class: "gate__actions" }, ...actions)));

const showSignIn = () =>
  gate("Sign in to manage links", "Only the owner of go.xaverric.cz can create and edit short links.", h("a", { class: "btn btn--accent", href: signInHref() }, "Sign in with GitHub"));

const showError = (error, retry) => gate("Something went wrong", error.message, h("button", { class: "btn", type: "button", onclick: retry }, "Try again"));

const showMe = (me) => {
  const bar = document.querySelector("[data-me]");
  const avatar = bar.querySelector("[data-me-avatar]");
  bar.querySelector("[data-me-login]").textContent = me.login ? `@${me.login}` : "";
  if (me.avatarUrl) {
    avatar.src = me.avatarUrl;
    avatar.hidden = false;
  }
  bar.hidden = false;
};

const hideMe = () => {
  document.querySelector("[data-me]").hidden = true;
};

const nodes = {};

const visibleLinks = () => {
  const query = state.query.trim().toLowerCase();
  return query ? state.links.filter((link) => link.slug.toLowerCase().includes(query) || link.url.toLowerCase().includes(query)) : state.links;
};

const selectedLink = () => state.links.find((link) => link.slug === state.selected) ?? null;

const replaceLink = (link) => {
  state.links = state.links.map((item) => (item.slug === link.slug ? link : item));
};

const placeDetail = () => {
  const detail = nodes.detail;
  if (!detail) {
    nodes.side.replaceChildren(h("div", { class: "side-empty muted" }, h("p", {}, "Select a link to see its clicks, countries and referrers.")));
    return;
  }
  if (WIDE.matches) {
    nodes.side.replaceChildren(detail);
    return;
  }
  nodes.side.replaceChildren();
  const row = nodes.list.querySelector(`[data-slug="${CSS.escape(state.selected)}"]`);
  if (row) row.after(h("li", { class: "links__detail" }, detail));
};

const drawDetail = ({ focus = false } = {}) => {
  const link = selectedLink();
  nodes.detail = link ? renderDetail(link, { onUpdate: (changes, options) => updateLink(link.slug, changes, options), onDelete: scheduleDelete, onClose: () => select(null) }) : null;
  drawList();
  if (focus && nodes.detail) {
    nodes.detail.focus({ preventScroll: WIDE.matches });
    if (!WIDE.matches) nodes.detail.scrollIntoView({ block: "nearest" });
  }
};

const select = (slug) => {
  const previous = state.selected;
  state.selected = state.selected === slug ? null : slug;
  drawDetail({ focus: Boolean(state.selected) });
  if (!state.selected && previous) nodes.list.querySelector(`[data-slug="${CSS.escape(previous)}"] button`)?.focus();
};

const linkRow = (link) =>
  h(
    "li",
    { class: "links__item", "data-slug": link.slug },
    h(
      "button",
      { class: "link-row", type: "button", "aria-expanded": String(state.selected === link.slug), "aria-current": state.selected === link.slug ? "true" : null, onclick: () => select(link.slug) },
      h("span", { class: "link-row__slug" }, h("span", { class: "link-row__slash" }, "/"), link.slug),
      link.status === "active" ? null : statusTag(link.status),
      h("span", { class: "link-row__clicks tnum" }, formatCount(link.clicks), h("span", { class: "sr-only" }, link.clicks === 1 ? " click" : " clicks")),
      h("span", { class: "link-row__target muted" }, displayUrl(link.url)),
      h("span", { class: "link-row__date muted tnum" }, formatDate(link.createdAt)),
    ),
  );

const skeletonRows = () =>
  Array.from({ length: 4 }, () => h("li", { class: "links__item links__item--skeleton", "aria-hidden": "true" }, h("span", { class: "skeleton skeleton--slug" }), h("span", { class: "skeleton" })));

const drawList = () => {
  if (!nodes.list) return;
  const links = visibleLinks();
  nodes.count.textContent = state.loaded ? formatCount(state.links.length) : "";
  if (!state.loaded) {
    nodes.list.replaceChildren(...skeletonRows());
    nodes.list.setAttribute("aria-busy", "true");
    return;
  }
  nodes.list.removeAttribute("aria-busy");
  if (!state.links.length) nodes.list.replaceChildren(h("li", { class: "links__empty muted" }, "No links yet. Shorten your first one above."));
  else if (!links.length) nodes.list.replaceChildren(h("li", { class: "links__empty muted" }, `No links match "${state.query.trim()}".`));
  else nodes.list.replaceChildren(...links.map(linkRow));
  placeDetail();
};

const updateLink = async (slug, changes, { rethrow = false } = {}) => {
  try {
    replaceLink(await api.patch(linkPath(slug), changes));
    if (changes.disabled !== undefined) toast({ message: changes.disabled ? `/${slug} is disabled and answers 404.` : `/${slug} redirects again.` });
    drawDetail();
  } catch (error) {
    if (rethrow) throw error;
    toast({ tone: "error", message: error.message, timeout: 0 });
    throw error;
  }
};

const restore = (link) => {
  state.links = [...state.links, link].sort(byNewest);
  drawList();
};

const commitDelete = async (link) => {
  if (!pendingDeletes.delete(link.slug)) return;
  try {
    await api.del(linkPath(link.slug));
  } catch (error) {
    if (error.status === 404) return;
    restore(link);
    toast({ tone: "error", message: `/${link.slug} could not be deleted. ${error.message}`, timeout: 0 });
  }
};

const scheduleDelete = (link) => {
  pendingDeletes.set(link.slug, link);
  state.links = state.links.filter((item) => item.slug !== link.slug);
  if (state.selected === link.slug) {
    state.selected = null;
    nodes.detail = null;
  }
  drawList();
  nodes.search.focus();
  toast({
    message: `Deleted /${link.slug}.`,
    action: {
      label: "Undo",
      run: () => {
        pendingDeletes.delete(link.slug);
        restore(link);
      },
    },
    onClose: (reason) => {
      if (reason !== "action") commitDelete(link);
    },
  });
};

addEventListener("pagehide", () => {
  pendingDeletes.forEach((link) => api.del(linkPath(link.slug), { keepalive: true }).catch(() => {}));
  pendingDeletes.clear();
});

const createCard = () => {
  const url = h("input", { class: "input", id: "new-url", type: "url", name: "url", required: true, maxlength: 2048, placeholder: "https://example.com/a/long/path", autocomplete: "off", spellcheck: "false" });
  const slug = h("input", { class: "input input--slug", id: "new-slug", name: "slug", maxlength: 64, placeholder: "random", autocomplete: "off", spellcheck: "false", pattern: "[A-Za-z0-9_\\-]{1,64}", "aria-describedby": "new-slug-help" });
  const expires = h("input", { class: "input", id: "new-expires", type: "datetime-local", name: "expiresAt" });
  const submit = h("button", { class: "btn btn--accent create__submit", type: "submit" }, "Shorten");
  const error = h("p", { class: "field-error", role: "alert", hidden: true });
  const result = h("div", { class: "result", hidden: true, "aria-live": "polite" });

  const showResult = (link) => {
    result.replaceChildren(h("span", { class: "result__label muted" }, "Ready"), h("a", { class: "result__link", href: link.shortUrl, target: "_blank", rel: "noopener" }, link.shortUrl.replace(/^https?:\/\//, "")), copyButton(link.shortUrl));
    result.hidden = false;
  };

  const onsubmit = async (event) => {
    event.preventDefault();
    error.hidden = true;
    const payload = { url: url.value.trim() };
    if (slug.value.trim()) payload.slug = slug.value.trim();
    if (payload.slug && !SLUG.test(payload.slug)) {
      slug.setCustomValidity("Use letters, digits, - or _.");
      slug.reportValidity();
      return;
    }
    if (expires.value) payload.expiresAt = fromLocalInput(expires.value);
    submit.setAttribute("aria-busy", "true");
    submit.disabled = true;
    try {
      const link = await api.post("/api/links", payload);
      state.links = [link, ...state.links.filter((item) => item.slug !== link.slug)];
      event.target.reset();
      showResult(link);
      drawList();
      result.querySelector(".copy-btn").focus();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    } finally {
      submit.removeAttribute("aria-busy");
      submit.disabled = false;
    }
  };
  slug.addEventListener("input", () => slug.setCustomValidity(""));

  return h(
    "section",
    { class: "create card", "aria-labelledby": "create-title" },
    h("h1", { class: "create__title", id: "create-title" }, "Shorten a link"),
    h(
      "form",
      { class: "create__form", onsubmit },
      h("label", { class: "field field--url", for: "new-url" }, h("span", { class: "field__label" }, "Target URL"), url),
      h(
        "label",
        { class: "field field--slug", for: "new-slug" },
        h("span", { class: "field__label" }, "Slug ", h("span", { class: "muted", id: "new-slug-help" }, "(optional)")),
        h("span", { class: "affix" }, h("span", { class: "affix__prefix muted", "aria-hidden": "true" }, `${location.host}/`), slug),
      ),
      h("label", { class: "field field--expires", for: "new-expires" }, h("span", { class: "field__label" }, "Expires ", h("span", { class: "muted" }, "(optional)")), expires),
      submit,
    ),
    error,
    result,
  );
};

const indexSection = () => {
  nodes.count = h("span", { class: "tag tag--neutral tnum" });
  nodes.search = h("input", { class: "input search__input", type: "search", name: "q", placeholder: "Filter by slug or URL", "aria-label": "Filter links", autocomplete: "off", spellcheck: "false" });
  nodes.search.addEventListener("input", () => {
    state.query = nodes.search.value;
    drawList();
  });
  nodes.list = h("ul", { class: "links", "aria-label": "Links" });
  return h(
    "section",
    { class: "index", "aria-labelledby": "index-title" },
    h("header", { class: "index__head" }, h("h2", { class: "index__title", id: "index-title" }, "Links ", nodes.count), h("label", { class: "search" }, nodes.search)),
    nodes.list,
  );
};

const loadLinks = async () => {
  state.loaded = false;
  drawList();
  try {
    state.links = (await api.get("/api/links")).links.sort(byNewest);
    state.loaded = true;
    drawList();
  } catch (error) {
    nodes.list.removeAttribute("aria-busy");
    nodes.list.replaceChildren(
      h("li", { class: "links__empty inline-error", role: "alert" }, h("p", {}, `Links could not be loaded. ${error.message}`), h("button", { class: "btn btn--sm", type: "button", onclick: loadLinks }, "Try again")),
    );
  }
};

const showApp = () => {
  nodes.side = h("aside", { class: "layout__side", "aria-label": "Link details" });
  clear(main).append(h("div", { class: "layout" }, h("div", { class: "layout__main" }, createCard(), indexSection()), nodes.side));
  WIDE.addEventListener("change", () => drawList());
  loadLinks();
};

const signOut = document.querySelector("[data-signout]");

signOut.addEventListener("click", async () => {
  signOut.disabled = true;
  try {
    await api.post("/auth/logout");
    hideMe();
    showSignIn();
  } catch (error) {
    toast({ tone: "error", message: error.message, timeout: 0 });
  } finally {
    signOut.disabled = false;
  }
});

addEventListener("keydown", (event) => {
  if (event.key === "/" && nodes.search && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) {
    event.preventDefault();
    nodes.search.focus();
  }
});

const start = async () => {
  try {
    const me = await api.get("/api/me");
    showMe(me);
    showApp();
  } catch (error) {
    if (error.status === 401) return showSignIn();
    if (error.status === 403) {
      showMe({});
      return gate("Not allowed", "This GitHub account cannot manage go.xaverric.cz links. Sign out and use the owner account.");
    }
    showError(error, start);
  }
};

start();
