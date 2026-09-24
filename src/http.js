export const MAX_BODY_BYTES = 16 * 1024;

export const CONTENT_SECURITY_POLICY =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: https://avatars.githubusercontent.com; font-src 'self'; connect-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'none'";

export const STRICT_TRANSPORT_SECURITY = "max-age=31536000; includeSubDomains";

export const DEFAULT_REFERRER_POLICY = "strict-origin-when-cross-origin";

export const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "content-security-policy": CONTENT_SECURITY_POLICY,
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "x-robots-tag": "noindex, nofollow",
};

export class HttpError extends Error {
  constructor(status, code, message, headers = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

export const badRequest = (message) => new HttpError(400, "invalid_request", message);

export const json = (data, { status = 200, headers = {} } = {}) => Response.json(data, { status, headers: { "cache-control": "no-store", ...headers } });

export const errorResponse = (status, code, message, headers = {}) => json({ error: { code, message } }, { status, headers });

export const noContent = (headers = new Headers()) => {
  headers.set("cache-control", "no-store");
  return new Response(null, { status: 204, headers });
};

export const redirect = (location, cookies = [], status = 302) => {
  const headers = new Headers({ location, "cache-control": "no-store" });
  cookies.forEach((cookie) => headers.append("set-cookie", cookie));
  return new Response(null, { status, headers });
};

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const htmlPage = (status, title, message, { headers = {} } = {}) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)} - go.xaverric.cz</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/css/tokens.css"><link rel="stylesheet" href="/css/base.css"><link rel="stylesheet" href="/css/page.css"></head><body><main class="page-message"><p class="wordmark"><span class="wordmark__dot" aria-hidden="true"></span>go.xaverric.cz</p><h1>${escapeHtml(title)}</h1><p class="muted">${escapeHtml(message)}</p><p><a class="btn btn--sm" href="https://xaverric.cz">Go to xaverric.cz</a></p></main></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...headers } },
  );

const isJsonType = (value) => /^application\/json\s*(;|$)/i.test(value ?? "");

const readLimited = async (request) => {
  const reader = request.body?.getReader();
  const chunks = [];
  let size = 0;
  if (!reader) return new Uint8Array();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new HttpError(413, "invalid_request", "Body too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const buffer = new Uint8Array(size);
  chunks.reduce((offset, chunk) => {
    buffer.set(chunk, offset);
    return offset + chunk.byteLength;
  }, 0);
  return buffer;
};

export const readJsonBody = async (request) => {
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) throw new HttpError(413, "invalid_request", "Body too large");
  if (!isJsonType(request.headers.get("content-type"))) throw badRequest("Content-Type must be application/json");
  const buffer = await readLimited(request);
  try {
    return JSON.parse(new TextDecoder().decode(buffer));
  } catch {
    throw badRequest("Invalid JSON body");
  }
};

export const withSecurityHeaders = (response, request) => {
  const secured = new Response(response.body, response);
  Object.entries(SECURITY_HEADERS).forEach(([name, value]) => secured.headers.set(name, value));
  if (!secured.headers.has("referrer-policy")) secured.headers.set("referrer-policy", DEFAULT_REFERRER_POLICY);
  if (new URL(request.url).protocol === "https:") secured.headers.set("strict-transport-security", STRICT_TRANSPORT_SECURITY);
  return secured;
};

export const toErrorResponse = (error) => {
  if (error instanceof HttpError) return errorResponse(error.status, error.code, error.message, error.headers);
  console.error("Unhandled worker error", error?.name ?? "Error", error?.message ?? "");
  return errorResponse(500, "internal", "Internal error");
};
