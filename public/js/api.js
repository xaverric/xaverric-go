export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const init = (method, payload, extra) => ({
  method,
  credentials: "same-origin",
  headers: payload === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
  body: payload === undefined ? undefined : JSON.stringify(payload),
  ...extra,
});

const request = async (method, path, payload, extra = {}) => {
  let response;
  try {
    response = await fetch(path, init(method, payload, extra));
  } catch {
    throw new ApiError(0, "network", "Could not reach the server. Check your connection and try again.");
  }
  if (response.status === 204) return null;
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, body?.error?.code ?? "internal", body?.error?.message ?? `The server answered ${response.status}.`);
  return body;
};

export const api = {
  get: (path) => request("GET", path),
  post: (path, payload) => request("POST", path, payload),
  patch: (path, payload) => request("PATCH", path, payload),
  del: (path, extra) => request("DELETE", path, undefined, extra),
};

export const linkPath = (slug) => `/api/links/${encodeURIComponent(slug)}`;
