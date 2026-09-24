import { isAdmin } from "./access.js";
import { cookieName, parseCookies } from "./cookies.js";
import { HttpError } from "./http.js";
import { SESSION_COOKIE, findSessionUser, verifyValue } from "./session.js";

const nowSeconds = (now) => Math.floor(now.getTime() / 1000);

export const sessionUser = async (request, env, now) => {
  const cookie = parseCookies(request.headers.get("cookie"))[cookieName(SESSION_COOKIE, env)];
  const payload = await verifyValue(cookie, env.SESSION_SECRET, nowSeconds(now), "session");
  return payload ? findSessionUser(env, payload, nowSeconds(now)) : null;
};

export const assertSameOrigin = (request) => {
  const origin = request.headers.get("origin");
  const sameOrigin = origin === new URL(request.url).origin || (!origin && request.headers.get("sec-fetch-site") === "same-origin");
  if (!sameOrigin) throw new HttpError(403, "forbidden", "Cross-origin request rejected");
};

export const requireAdmin = async ({ request, env, now }) => {
  const user = await sessionUser(request, env, now);
  if (!user) throw new HttpError(401, "unauthorized", "Authentication required");
  if (!isAdmin(user.github_id, env)) throw new HttpError(403, "forbidden", "Not allowed");
  if (!["GET", "HEAD"].includes(request.method)) assertSameOrigin(request);
  return user;
};
