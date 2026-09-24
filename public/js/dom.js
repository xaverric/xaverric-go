const SVG_NS = "http://www.w3.org/2000/svg";

const append = (parent, children) => {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
};

const assign = (el, attrs = {}) => {
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "style" && typeof value === "object") for (const [prop, v] of Object.entries(value)) el.style.setProperty(prop, v);
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  return el;
};

export const h = (tag, attrs, ...children) => append(assign(document.createElement(tag), attrs), children);

export const svg = (tag, attrs, ...children) => append(assign(document.createElementNS(SVG_NS, tag), attrs), children);

export const clear = (el) => {
  el.replaceChildren();
  return el;
};

export const skeleton = (className = "") => h("span", { class: `skeleton ${className}`.trim(), "aria-hidden": "true" });

export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
