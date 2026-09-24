import { devLoginAllowed, isAdmin } from "../access.js";
import { assertSameOrigin } from "../auth.js";
import { cookieName, isLocalApp, parseCookies, serializeCookie } from "../cookies.js";
import { base64urlEncode, utf8 } from "../encoding.js";
import { exchangeCode, getGithubUser, isGithubLogin } from "../github.js";
import { HttpError, htmlPage, noContent, redirect } from "../http.js";
import { upsertDevUser, upsertUser } from "../queries.js";
import { SESSION_COOKIE, SESSION_MAX_AGE, STATE_COOKIE, STATE_MAX_AGE, createSession, equalStrings, revokeSession, signValue, verifyValue } from "../session.js";

const cookie = (env, name, value, { maxAge }) =>
  serializeCookie(cookieName(name, env), value, { maxAge, path: "/", httpOnly: true, secure: !isLocalApp(env), sameSite: "Lax" });

const nowSeconds = (now) => Math.floor(now.getTime() / 1000);

const callbackUrl = (env) => `${env.APP_URL}/auth/github/callback`;

export const safeNext = (next, fallback = "/admin") =>
  typeof next === "string" && next.length <= 512 && /^\/(?![/\\])[\x21-\x7e]*$/.test(next) ? next : fallback;

const sessionCookie = async (env, userId, now) => cookie(env, SESSION_COOKIE, await createSession(env, userId, nowSeconds(now)), { maxAge: SESSION_MAX_AGE });

const clearStateCookie = (env) => cookie(env, STATE_COOKIE, "", { maxAge: 0 });

const pageClearingState = (env, status, title, message) => {
  const page = htmlPage(status, title, message);
  page.headers.append("set-cookie", clearStateCookie(env));
  return page;
};

export const startGithubLogin = async ({ env, url, now }) => {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) throw new HttpError(500, "internal", "GitHub login is not configured");
  const state = base64urlEncode(crypto.getRandomValues(new Uint8Array(24)));
  const verifier = base64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64urlEncode(await crypto.subtle.digest("SHA-256", utf8(verifier)));
  const next = safeNext(url.searchParams.get("next") ?? undefined);
  const signed = await signValue({ typ: "state", state, next, verifier, exp: nowSeconds(now) + STATE_MAX_AGE }, env.SESSION_SECRET);
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.search = new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, redirect_uri: callbackUrl(env), state, code_challenge: challenge, code_challenge_method: "S256" }).toString();
  return redirect(authorize.href, [cookie(env, STATE_COOKIE, signed, { maxAge: STATE_MAX_AGE })]);
};

const loginFailed = (env) => pageClearingState(env, 400, "Login failed", "The GitHub login expired or was interrupted. Please try again.");

export const finishGithubLogin = async ({ request, env, url, now }) => {
  const saved = await verifyValue(parseCookies(request.headers.get("cookie"))[cookieName(STATE_COOKIE, env)], env.SESSION_SECRET, nowSeconds(now), "state");
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!saved || !state || !equalStrings(saved.state, state) || !code || !/^[A-Za-z0-9_-]{43}$/.test(saved.verifier ?? "")) return loginFailed(env);
  const token = await exchangeCode({ code, verifier: saved.verifier, redirectUri: callbackUrl(env), env });
  const profile = token ? await getGithubUser(token, env).catch(() => null) : null;
  if (!profile) return loginFailed(env);
  if (!isAdmin(profile.githubId, env)) return pageClearingState(env, 403, "Not allowed", "This GitHub account cannot manage go.xaverric.cz links.");
  const user = await upsertUser(env.DB, profile, now.toISOString());
  return redirect(safeNext(saved.next), [await sessionCookie(env, user.id, now), clearStateCookie(env)]);
};

export const devLogin = async ({ env, url, now }) => {
  if (!devLoginAllowed(env) || url.origin !== new URL(env.APP_URL).origin) throw new HttpError(404, "not_found", "Not found");
  const login = url.searchParams.get("login") ?? "";
  if (!isGithubLogin(login)) throw new HttpError(400, "invalid_request", "login: invalid GitHub login");
  const user = await upsertDevUser(env.DB, login, now.toISOString());
  return redirect(safeNext(url.searchParams.get("next") ?? undefined), [await sessionCookie(env, user.id, now)]);
};

export const logout = async ({ request, env, now }) => {
  assertSameOrigin(request);
  await revokeSession(env, parseCookies(request.headers.get("cookie"))[cookieName(SESSION_COOKIE, env)], nowSeconds(now));
  return noContent(new Headers({ "set-cookie": cookie(env, SESSION_COOKIE, "", { maxAge: 0 }) }));
};
