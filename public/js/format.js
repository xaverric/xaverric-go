const UNITS = [
  ["year", 31536000],
  ["month", 2592000],
  ["week", 604800],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export const relativeTime = (iso, now = Date.now()) => {
  if (!iso) return "never";
  const seconds = (new Date(iso).getTime() - now) / 1000;
  const unit = UNITS.find(([, size]) => Math.abs(seconds) >= size);
  return unit ? relative.format(Math.round(seconds / unit[1]), unit[0]) : "just now";
};

const dateFormat = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" });

const dateTimeFormat = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

const dayFormat = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", timeZone: "UTC" });

export const formatDate = (iso) => (iso ? dateFormat.format(new Date(iso)) : "");

export const formatDateTime = (iso) => (iso ? dateTimeFormat.format(new Date(iso)) : "");

export const formatDay = (day) => dayFormat.format(new Date(`${day}T00:00:00Z`));

export const formatCount = (n) => new Intl.NumberFormat("en").format(n);

export const plural = (n, word) => `${formatCount(n)} ${word}${n === 1 ? "" : "s"}`;

const regions = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    return null;
  }
})();

export const countryName = (code) => {
  if (!code) return "Unknown";
  try {
    return regions?.of(code) ?? code;
  } catch {
    return code;
  }
};

export const referrerName = (host) => host || "Direct or hidden";

export const displayUrl = (url) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");

const pad = (n) => String(n).padStart(2, "0");

export const toLocalInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const fromLocalInput = (value) => (value ? new Date(value).toISOString() : null);
