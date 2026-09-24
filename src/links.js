export const SLUG_ALPHABET = "23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
export const RANDOM_SLUG_LENGTH = 6;
export const MAX_URL_LENGTH = 2048;

const SLUG_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const ISO_START = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const ISO_ZONE = /(Z|[+-]\d{2}:\d{2})$/;
const RESERVED = new Set(["admin", "api", "auth", "assets", "css", "js", "fonts", "favicon.ico", "favicon.svg", "robots.txt", "_headers"]);

export const isSlug = (value) => typeof value === "string" && SLUG_PATTERN.test(value);

export const isReservedSlug = (value) => RESERVED.has(String(value).toLowerCase());

export const randomSlug = () => {
  const limit = 256 - (256 % SLUG_ALPHABET.length);
  let slug = "";
  while (slug.length < RANDOM_SLUG_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      if (byte < limit && slug.length < RANDOM_SLUG_LENGTH) slug += SLUG_ALPHABET[byte % SLUG_ALPHABET.length];
    }
  }
  return slug;
};

export const validateSlug = (value) => {
  if (!isSlug(value)) return "slug: use 1-64 letters, digits, - or _";
  if (isReservedSlug(value)) return "slug: reserved";
  return null;
};

const hostOf = (value) => {
  try {
    return new URL(value).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return "";
  }
};

const parseUrl = (value) => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

export const validateTarget = (value, appUrl) => {
  if (typeof value !== "string" || !value.trim()) return { error: "url: required" };
  const text = value.trim();
  if (text.length > MAX_URL_LENGTH) return { error: `url: at most ${MAX_URL_LENGTH} characters` };
  const url = parseUrl(text);
  if (!url) return { error: "url: must be an absolute URL" };
  if (!["http:", "https:"].includes(url.protocol)) return { error: "url: must start with http:// or https://" };
  if (url.username || url.password) return { error: "url: must not contain credentials" };
  if (hostOf(url.href) === hostOf(appUrl)) return { error: "url: must not point at this shortener" };
  if (url.href.length > MAX_URL_LENGTH) return { error: `url: at most ${MAX_URL_LENGTH} characters` };
  return { url: url.href };
};

export const parseExpiry = (value, now) => {
  if (value === null) return { value: null };
  if (typeof value !== "string" || value.length > 40 || !ISO_START.test(value) || !ISO_ZONE.test(value)) return { error: "expiresAt: must be an ISO 8601 timestamp with a time zone" };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { error: "expiresAt: invalid date" };
  if (date <= now) return { error: "expiresAt: must be in the future" };
  return { value: date.toISOString() };
};

export const linkStatus = (row, now) => {
  if (row.disabled_at) return "disabled";
  if (row.expires_at && row.expires_at <= now.toISOString()) return "expired";
  return "active";
};

export const toLink = (row, env, now) => ({
  slug: row.slug,
  url: row.url,
  shortUrl: `${env.APP_URL}/${row.slug}`,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  expiresAt: row.expires_at,
  disabledAt: row.disabled_at,
  clicks: row.clicks,
  lastClickAt: row.last_click_at,
  status: linkStatus(row, now),
});

const COUNTRY_PATTERN = /^[A-Z0-9]{2}$/;

export const clickCountry = (request) => {
  const country = request.cf?.country;
  return typeof country === "string" && COUNTRY_PATTERN.test(country) ? country : "";
};

export const referrerHost = (request) => {
  const url = parseUrl(request.headers.get("referer") ?? "");
  if (!url || !["http:", "https:"].includes(url.protocol)) return "";
  return url.hostname.toLowerCase().slice(0, 253);
};
