import { formatCount, formatDay, plural } from "./format.js";
import { h, svg } from "./dom.js";

const WIDTH = 300;
const HEIGHT = 88;
const GAP = 2;

const barHeight = (clicks, max) => (clicks ? Math.max(3, (clicks / max) * (HEIGHT - 2)) : 1.5);

export const clickChart = (series) => {
  const max = Math.max(1, ...series.map((point) => point.clicks));
  const total = series.reduce((sum, point) => sum + point.clicks, 0);
  const width = (WIDTH - GAP * (series.length - 1)) / series.length;
  const peak = series.reduce((best, point) => (point.clicks > best.clicks ? point : best), series[0]);
  const readout = h("p", { class: "chart__readout tnum", "aria-live": "polite" }, total ? `Peak ${plural(peak.clicks, "click")} on ${formatDay(peak.day)}` : "No clicks in this period");
  const show = (point) => {
    readout.textContent = `${formatDay(point.day)}: ${plural(point.clicks, "click")}`;
  };
  const bars = series.map((point, i) => {
    const height = barHeight(point.clicks, max);
    const bar = svg(
      "rect",
      { class: point.clicks ? "chart__bar" : "chart__bar chart__bar--zero", x: i * (width + GAP), y: HEIGHT - height, width, height, rx: 1.5 },
      svg("title", {}, `${formatDay(point.day)}: ${plural(point.clicks, "click")}`),
    );
    bar.addEventListener("pointerenter", () => show(point));
    return bar;
  });
  const label = `${plural(total, "click")} in the last ${series.length} days, most on ${formatDay(peak.day)} with ${formatCount(peak.clicks)}`;
  return h(
    "figure",
    { class: "chart" },
    h("div", { class: "chart__plot" }, h("span", { class: "chart__max tnum muted", "aria-hidden": "true" }, formatCount(max)), svg("svg", { class: "chart__svg", viewBox: `0 0 ${WIDTH} ${HEIGHT}`, preserveAspectRatio: "none", role: "img", "aria-label": label }, bars)),
    h("figcaption", { class: "chart__axis muted tnum" }, h("span", {}, formatDay(series[0].day)), h("span", {}, "Today")),
    readout,
  );
};
