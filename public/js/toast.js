import { h } from "./dom.js";

const region = () => {
  let el = document.querySelector(".toast-region");
  if (!el) {
    el = h("div", { class: "toast-region", role: "status", "aria-live": "polite" });
    document.body.append(el);
  }
  return el;
};

export const toast = ({ message, action, tone = "info", timeout = 6000, onClose = () => {} }) => {
  let timer = null;
  let closed = false;

  const close = (reason) => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    node.dataset.state = "leaving";
    setTimeout(() => node.remove(), 180);
    onClose(reason);
  };

  const arm = () => {
    clearTimeout(timer);
    if (timeout) timer = setTimeout(() => close("timeout"), timeout);
  };

  const node = h(
    "div",
    { class: "toast", "data-tone": tone },
    h("p", { class: "toast__message" }, message),
    action
      ? h("button", { type: "button", class: "toast__action", onclick: () => { close("action"); action.run(); } }, action.label)
      : null,
    h("button", { type: "button", class: "toast__close", "aria-label": "Dismiss", onclick: () => close("dismiss") }, "×"),
  );

  node.addEventListener("pointerenter", () => clearTimeout(timer));
  node.addEventListener("pointerleave", arm);
  node.addEventListener("focusin", () => clearTimeout(timer));
  node.addEventListener("focusout", arm);
  region().append(node);
  arm();

  return { close };
};
