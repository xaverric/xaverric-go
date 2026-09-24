import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { vi } from "vitest";
import worker from "../src/index.js";
import { cookieName } from "../src/cookies.js";
import { SESSION_COOKIE, createSession } from "../src/session.js";

export const ORIGIN = "https://go.xaverric.cz";

export const ADMIN_ID = 19148363;

export const TEST_SECRET = "test-session-secret-0123456789abcdef";

export const okLimiter = () => ({ limit: async () => ({ success: true }) });

const ASSETS = {
  "/admin.html": "<!doctype html><title>admin</title>",
  "/css/base.css": "body{}",
};

export const assets = {
  fetch: async (request) => {
    const body = ASSETS[new URL(request.url).pathname];
    return body ? new Response(body, { headers: { "content-type": "text/html" } }) : new Response("missing", { status: 404 });
  },
};

export const makeEnv = (overrides = {}) => ({
  DB: env.DB,
  AUTH_LIMITER: okLimiter(),
  API_LIMITER: okLimiter(),
  ASSETS: assets,
  APP_URL: ORIGIN,
  GITHUB_CLIENT_ID: "test-client-id",
  GITHUB_CLIENT_SECRET: "test-client-secret",
  SESSION_SECRET: TEST_SECRET,
  ADMIN_GITHUB_IDS: String(ADMIN_ID),
  ...overrides,
});

export const call = async (method, path, { body, headers = {}, env: envOverrides, raw, cf } = {}) => {
  const init = { method, headers: Object.fromEntries(Object.entries(headers).filter(([, value]) => value !== undefined)) };
  if (raw !== undefined) init.body = raw;
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers["content-type"] ??= "application/json";
  }
  if (init.headers.cookie && !["GET", "HEAD"].includes(method) && !("origin" in headers)) init.headers.origin = ORIGIN;
  if (cf) init.cf = cf;
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(new URL(path, ORIGIN), init), makeEnv(envOverrides), ctx);
  await waitOnExecutionContext(ctx);
  return response;
};

export const resetDb = () => env.DB.batch(["clicks_daily", "links", "web_sessions", "users"].map((table) => env.DB.prepare(`DELETE FROM ${table}`)));

export const insertUser = async (githubId, login) =>
  (await env.DB.prepare("INSERT INTO users (github_id, login, name, avatar_url, created_at) VALUES (?1, ?2, ?2, NULL, ?3) RETURNING id")
    .bind(githubId, login, new Date().toISOString())
    .first()).id;

export const sessionCookie = async (uid, exp = Math.floor(Date.now() / 1000) + 3600) =>
  `${cookieName(SESSION_COOKIE, makeEnv())}=${await createSession(makeEnv(), uid, Math.floor(Date.now() / 1000), exp)}`;

export const adminCookie = async () => sessionCookie(await insertUser(ADMIN_ID, "xaverric"));

export const insertLink = (slug, url, extra = {}) =>
  env.DB.prepare("INSERT INTO links (slug, url, created_at, expires_at, disabled_at, clicks) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
    .bind(slug, url, extra.createdAt ?? new Date().toISOString(), extra.expiresAt ?? null, extra.disabledAt ?? null, extra.clicks ?? 0)
    .run();

export const githubUser = (id, login) => ({ id, login, name: login, avatar_url: `https://avatars.githubusercontent.com/u/${id}` });

export const mockGithub = ({ users = {}, codes = {} } = {}) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init = {}) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.href === "https://github.com/login/oauth/access_token") {
      const { code } = await request.json();
      return Response.json(codes[code] ? { access_token: codes[code] } : { error: "bad_verification_code" });
    }
    if (url.href === "https://api.github.com/applications/test-client-id/token" && request.method === "POST") {
      const { access_token: checked } = await request.json();
      return users[checked] ? Response.json({ user: users[checked] }) : Response.json({ message: "Not Found" }, { status: 404 });
    }
    return new Response("unexpected", { status: 599 });
  });

export const setCookies = (response) => response.headers.getSetCookie();
