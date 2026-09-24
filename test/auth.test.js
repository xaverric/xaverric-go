import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseCookies } from "../src/cookies.js";
import { base64urlEncode, utf8 } from "../src/encoding.js";
import { signValue, verifyValue } from "../src/session.js";
import { ADMIN_ID, ORIGIN, TEST_SECRET, call, githubUser, insertUser, mockGithub, resetDb, sessionCookie, setCookies } from "./helpers.js";

const nowSec = () => Math.floor(Date.now() / 1000);

const cookieValue = (response, name) => {
  const header = setCookies(response).find((c) => c.startsWith(`${name}=`));
  return header ? parseCookies(header.split(";")[0])[name] : undefined;
};

const startLogin = async (next = "/admin") => {
  const response = await call("GET", `/auth/github?next=${encodeURIComponent(next)}`);
  const location = new URL(response.headers.get("location"));
  return { response, location, state: location.searchParams.get("state"), stateCookie: cookieValue(response, "__Host-go_oauth_state") };
};

const callback = ({ code = "owner", state, stateCookie, envOverrides }) =>
  call("GET", `/auth/github/callback?code=${code}&state=${state}`, {
    headers: stateCookie ? { cookie: `__Host-go_oauth_state=${stateCookie}` } : {},
    env: envOverrides,
  });

beforeEach(async () => {
  await resetDb();
  mockGithub({
    users: { gho_owner: githubUser(ADMIN_ID, "xaverric"), gho_other: githubUser(42, "someone"), gho_impostor: githubUser(7, "xaverric") },
    codes: { owner: "gho_owner", other: "gho_other", impostor: "gho_impostor" },
  });
});

afterEach(() => vi.restoreAllMocks());

describe("GET /auth/github", () => {
  it("redirects to GitHub with PKCE and a signed state cookie", async () => {
    const { response, location, state, stateCookie } = await startLogin();
    expect(response.status).toBe(302);
    expect(`${location.origin}${location.pathname}`).toBe("https://github.com/login/oauth/authorize");
    expect(location.searchParams.get("client_id")).toBe("test-client-id");
    expect(location.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/auth/github/callback`);
    expect(location.searchParams.get("scope")).toBeNull();
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(setCookies(response)[0]).toMatch(/^__Host-go_oauth_state=[^;]+; Path=\/; Max-Age=600; HttpOnly; Secure; SameSite=Lax$/);
    const saved = await verifyValue(stateCookie, TEST_SECRET, nowSec(), "state");
    expect(saved).toMatchObject({ state, next: "/admin" });
    expect(location.searchParams.get("code_challenge")).toBe(base64urlEncode(await crypto.subtle.digest("SHA-256", utf8(saved.verifier))));
  });

  it.each([["//evil.com"], ["https://evil.com"], ["/\\evil.com"]])("replaces unsafe next %s with /admin", async (next) => {
    const { stateCookie } = await startLogin(next);
    expect((await verifyValue(stateCookie, TEST_SECRET, nowSec())).next).toBe("/admin");
  });

  it("fails when GitHub is not configured", async () => {
    expect((await call("GET", "/auth/github", { env: { GITHUB_CLIENT_ID: "" } })).status).toBe(500);
  });
});

describe("GET /auth/github/callback", () => {
  it("signs the owner in and sends the PKCE verifier", async () => {
    const { state, stateCookie } = await startLogin();
    const { verifier } = await verifyValue(stateCookie, TEST_SECRET, nowSec());
    const response = await callback({ state, stateCookie });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/admin");
    const exchange = globalThis.fetch.mock.calls.find(([url]) => url === "https://github.com/login/oauth/access_token");
    expect(JSON.parse(exchange[1].body).code_verifier).toBe(verifier);
    const cookies = setCookies(response);
    expect(cookies.find((c) => c.startsWith("__Host-go_session="))).toMatch(/; Path=\/; Max-Age=604800; HttpOnly; Secure; SameSite=Lax$/);
    expect(cookies.find((c) => c.startsWith("__Host-go_oauth_state="))).toMatch(/Max-Age=0/);
    const user = await env.DB.prepare("SELECT id, github_id, login FROM users").first();
    expect(user).toMatchObject({ github_id: ADMIN_ID, login: "xaverric" });
    const session = await verifyValue(cookieValue(response, "__Host-go_session"), TEST_SECRET, nowSec(), "session");
    expect(session.uid).toBe(user.id);
    expect(session.exp).toBeGreaterThan(nowSec() + 604800 - 60);
  });

  it.each([["other"], ["impostor"]])("refuses %s with 403, no session and no user row", async (code) => {
    const { state, stateCookie } = await startLogin();
    const response = await callback({ code, state, stateCookie });
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("Not allowed");
    expect(setCookies(response).some((c) => c.startsWith("__Host-go_session="))).toBe(false);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first()).n).toBe(0);
  });

  it("refuses everyone when ADMIN_GITHUB_IDS is empty", async () => {
    const { state, stateCookie } = await startLogin();
    expect((await callback({ state, stateCookie, envOverrides: { ADMIN_GITHUB_IDS: "" } })).status).toBe(403);
  });

  it("rejects a state mismatch, a missing cookie, an expired state and a bad code", async () => {
    const first = await startLogin();
    expect((await callback({ state: "other", stateCookie: first.stateCookie })).status).toBe(400);
    expect((await callback({ state: first.state })).status).toBe(400);
    const expired = await signValue({ typ: "state", state: "s1", next: "/admin", verifier: "v".repeat(43), exp: nowSec() - 1 }, TEST_SECRET);
    expect((await callback({ state: "s1", stateCookie: expired })).status).toBe(400);
    expect((await callback({ code: "nope", state: first.state, stateCookie: first.stateCookie })).status).toBe(400);
  });
});

describe("sessions", () => {
  it("revokes the server session on logout", async () => {
    const cookie = await sessionCookie(await insertUser(ADMIN_ID, "xaverric"));
    expect((await call("GET", "/api/me", { headers: { cookie } })).status).toBe(200);
    const response = await call("POST", "/auth/logout", { headers: { cookie } });
    expect(response.status).toBe(204);
    expect(setCookies(response)[0]).toMatch(/^__Host-go_session=; Path=\/; Max-Age=0; HttpOnly; Secure; SameSite=Lax$/);
    expect((await call("GET", "/api/me", { headers: { cookie } })).status).toBe(401);
  });

  it("rejects a cross-origin logout", async () => {
    expect((await call("POST", "/auth/logout", { headers: { origin: "https://evil.com" } })).status).toBe(403);
  });

  it("rejects an expired or forged session", async () => {
    const uid = await insertUser(ADMIN_ID, "xaverric");
    expect((await call("GET", "/api/me", { headers: { cookie: await sessionCookie(uid, nowSec() - 1) } })).status).toBe(401);
    const forged = await signValue({ typ: "session", uid, sid: `go_${"a".repeat(43)}`, exp: nowSec() + 3600 }, TEST_SECRET);
    expect((await call("GET", "/api/me", { headers: { cookie: `__Host-go_session=${forged}` } })).status).toBe(401);
  });

  it("locks out a session once its id leaves ADMIN_GITHUB_IDS", async () => {
    const cookie = await sessionCookie(await insertUser(ADMIN_ID, "xaverric"));
    expect((await call("GET", "/api/me", { headers: { cookie }, env: { ADMIN_GITHUB_IDS: "1" } })).status).toBe(403);
  });
});

describe("GET /auth/dev", () => {
  const local = "http://localhost:8788";
  const devEnv = { DEV_LOGIN: "1", APP_URL: local };
  const localCall = (method, path, options) => call(method, `${local}${path}`, options);

  it("signs in a local dev admin", async () => {
    const response = await localCall("GET", "/auth/dev?login=xaverric&next=/admin", { env: devEnv });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/admin");
    expect(setCookies(response)[0]).toMatch(/^go_session=[^;]+; Path=\/; Max-Age=604800; HttpOnly; SameSite=Lax$/);
    const user = await env.DB.prepare("SELECT github_id, login FROM users").first();
    expect(user.login).toBe("xaverric");
    expect(user.github_id).toBeLessThan(0);
    const cookie = setCookies(response)[0].split(";")[0];
    const me = await localCall("GET", "/api/me", { headers: { cookie }, env: devEnv });
    expect(me.status).toBe(200);
    expect((await localCall("GET", "/api/me", { headers: { cookie }, env: { APP_URL: local } })).status).toBe(403);
  });

  it("reuses the dev user for the same login", async () => {
    await localCall("GET", "/auth/dev?login=xaverric", { env: devEnv });
    await localCall("GET", "/auth/dev?login=xaverric", { env: devEnv });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first()).n).toBe(1);
  });

  it.each([
    ["without DEV_LOGIN", { APP_URL: local }],
    ["with DEV_LOGIN=true", { DEV_LOGIN: "true", APP_URL: local }],
    ["on 127.0.0.1 app url", { DEV_LOGIN: "1", APP_URL: "http://127.0.0.1:8788" }],
  ])("is 404 %s", async (name, envOverrides) => {
    expect((await localCall("GET", "/auth/dev?login=xaverric", { env: envOverrides })).status).toBe(404);
  });

  it("is unreachable on the production url", async () => {
    expect((await call("GET", "/auth/dev?login=xaverric", { env: { DEV_LOGIN: "1" } })).status).toBe(404);
    const plain = await localCall("GET", "/auth/dev?login=xaverric", { env: { DEV_LOGIN: "1" } });
    expect(plain.status).toBe(301);
  });

  it("rejects invalid logins", async () => {
    expect((await localCall("GET", "/auth/dev?login=b%40d", { env: devEnv })).status).toBe(400);
    expect((await localCall("GET", "/auth/dev", { env: devEnv })).status).toBe(400);
  });
});
