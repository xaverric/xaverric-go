import { api, linkPath } from "./api.js";
import { clickChart } from "./chart.js";
import { copyButton } from "./copy.js";
import { h } from "./dom.js";
import { countryName, formatCount, formatDateTime, fromLocalInput, plural, referrerName, relativeTime, toLocalInput } from "./format.js";

const STATUS_LABELS = { active: "Active", disabled: "Disabled", expired: "Expired" };

export const statusTag = (status) => h("span", { class: `tag tag--${status}` }, STATUS_LABELS[status]);

const fact = (term, value) => h("div", { class: "facts__item" }, h("dt", { class: "muted" }, term), h("dd", { class: "tnum" }, value));

const busy = async (button, work) => {
  button.setAttribute("aria-busy", "true");
  button.disabled = true;
  try {
    await work();
  } finally {
    button.removeAttribute("aria-busy");
    button.disabled = false;
  }
};

const topList = (title, rows, name) => {
  const max = Math.max(1, ...rows.map((row) => row.clicks));
  return h(
    "section",
    { class: "tops" },
    h("h3", { class: "tops__title" }, title),
    rows.length
      ? h(
          "ol",
          { class: "tops__list" },
          rows.map((row) =>
            h(
              "li",
              { class: "tops__row", style: { "--share": `${Math.round((row.clicks / max) * 100)}%` } },
              h("span", { class: "tops__name" }, name(row.key)),
              h("span", { class: "tops__count tnum" }, formatCount(row.clicks)),
            ),
          ),
        )
      : h("p", { class: "muted tops__empty" }, "Nothing yet."),
  );
};

const statsBody = (stats) =>
  h(
    "div",
    { class: "stats__body" },
    h("p", { class: "stats__total" }, h("strong", { class: "tnum" }, formatCount(stats.total)), ` ${stats.total === 1 ? "click" : "clicks"} in the last ${stats.days} days`),
    clickChart(stats.series),
    h("div", { class: "tops-grid" }, topList("Countries", stats.countries, countryName), topList("Referrers", stats.referrers, referrerName)),
  );

const statsSkeleton = () => h("div", { class: "stats__body", "aria-hidden": "true" }, h("span", { class: "skeleton skeleton--title" }), h("span", { class: "skeleton skeleton--chart" }));

const loadStats = async (container, slug) => {
  container.replaceChildren(statsSkeleton());
  container.setAttribute("aria-busy", "true");
  try {
    container.replaceChildren(statsBody(await api.get(`${linkPath(slug)}/stats?days=30`)));
  } catch (error) {
    container.replaceChildren(
      h("div", { class: "inline-error", role: "alert" }, h("p", {}, `Stats could not be loaded. ${error.message}`), h("button", { class: "btn btn--sm", type: "button", onclick: () => loadStats(container, slug) }, "Retry")),
    );
  } finally {
    container.removeAttribute("aria-busy");
  }
};

const editForm = (link, { onSave, onCancel }) => {
  const url = h("input", { class: "input", type: "url", name: "url", value: link.url, required: true, maxlength: 2048, autocomplete: "off", spellcheck: "false" });
  const expires = h("input", { class: "input", type: "datetime-local", name: "expiresAt", value: toLocalInput(link.expiresAt) });
  const error = h("p", { class: "field-error", role: "alert", hidden: true });
  const save = h("button", { class: "btn btn--sm btn--accent", type: "submit" }, "Save");
  const onsubmit = (event) => {
    event.preventDefault();
    error.hidden = true;
    const changes = {};
    if (url.value.trim() !== link.url) changes.url = url.value.trim();
    const expiresAt = fromLocalInput(expires.value);
    if (expiresAt !== link.expiresAt && toLocalInput(expiresAt) !== toLocalInput(link.expiresAt)) changes.expiresAt = expiresAt;
    if (!Object.keys(changes).length) return onCancel();
    busy(save, async () => {
      try {
        await onSave(changes);
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
      }
    });
  };
  return h(
    "form",
    { class: "edit-form", onsubmit },
    h("label", { class: "field" }, h("span", { class: "field__label" }, "Target URL"), url),
    h("label", { class: "field" }, h("span", { class: "field__label" }, "Expires ", h("span", { class: "muted" }, "(empty for never)")), expires),
    error,
    h("div", { class: "edit-form__actions" }, save, h("button", { class: "btn btn--sm btn--quiet", type: "button", onclick: onCancel }, "Cancel")),
  );
};

export const renderDetail = (link, { onUpdate, onDelete, onClose }) => {
  const stats = h("div", { class: "stats", "aria-label": "Clicks" });
  const actionsRow = h("div", { class: "detail__actions" });
  const editSlot = h("div", { class: "detail__edit" });

  const toggle = h(
    "button",
    {
      class: "btn btn--sm",
      type: "button",
      onclick: () => busy(toggle, () => onUpdate({ disabled: !link.disabledAt }).catch(() => {})),
    },
    link.disabledAt ? "Enable" : "Disable",
  );
  const edit = h(
    "button",
    {
      class: "btn btn--sm",
      type: "button",
      onclick: () => {
        actionsRow.hidden = true;
        const close = () => {
          editSlot.replaceChildren();
          actionsRow.hidden = false;
          edit.focus();
        };
        editSlot.replaceChildren(editForm(link, { onSave: (changes) => onUpdate(changes, { rethrow: true }), onCancel: close }));
        editSlot.querySelector("input").focus();
      },
    },
    "Edit",
  );
  const remove = h("button", { class: "btn btn--sm btn--danger", type: "button", onclick: () => onDelete(link) }, "Delete");
  actionsRow.append(edit, toggle, remove);

  const node = h(
    "article",
    { class: "detail card", "aria-labelledby": "detail-title", tabindex: "-1" },
    h(
      "header",
      { class: "detail__head" },
      h("h2", { class: "detail__slug", id: "detail-title" }, h("span", { class: "muted" }, "/"), link.slug),
      h("div", { class: "detail__head-actions" }, copyButton(link.shortUrl), h("button", { class: "btn btn--sm btn--quiet detail__close", type: "button", "aria-label": "Close details", onclick: onClose }, "Close")),
    ),
    h("a", { class: "detail__target", href: link.url, target: "_blank", rel: "noopener noreferrer" }, link.url),
    h(
      "dl",
      { class: "facts" },
      fact("Status", statusTag(link.status)),
      fact("Clicks", formatCount(link.clicks)),
      fact("Created", formatDateTime(link.createdAt)),
      fact("Expires", link.expiresAt ? formatDateTime(link.expiresAt) : "Never"),
      fact("Last click", link.lastClickAt ? relativeTime(link.lastClickAt) : "Never"),
    ),
    actionsRow,
    editSlot,
    h("h3", { class: "detail__section" }, "Last 30 days", h("span", { class: "sr-only" }, `, ${plural(link.clicks, "click")} all time`)),
    stats,
  );
  loadStats(stats, link.slug);
  return node;
};
