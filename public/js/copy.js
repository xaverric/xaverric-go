import { h } from "./dom.js";

export const copyButton = (text, { label = "Copy", ariaLabel = "Copy short link" } = {}) => {
  let timer = null;
  const button = h("button", { class: "btn btn--sm copy-btn", type: "button", "aria-label": ariaLabel }, label);
  const settle = (state, text) => {
    button.dataset.state = state;
    button.textContent = text;
    clearTimeout(timer);
    timer = setTimeout(() => {
      delete button.dataset.state;
      button.textContent = label;
    }, 1600);
  };
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      settle("copied", "Copied");
    } catch {
      settle("failed", "Failed");
    }
  });
  return button;
};
