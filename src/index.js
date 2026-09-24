import { isLocalApp } from "./cookies.js";
import { errorResponse, readJsonBody, redirect, toErrorResponse, withSecurityHeaders } from "./http.js";
import { isReservedSlug, isSlug } from "./links.js";
import { limitRequest } from "./rate-limit.js";
import { createRouter } from "./router.js";
import { getLinkStats, getLinks, getMe, patchLink, postLink, removeLink } from "./routes/links.js";
import { followLink, notFoundPage } from "./routes/redirect.js";
import { devLogin, finishGithubLogin, logout, startGithubLogin } from "./routes/web-auth.js";

const HOMEPAGE = "https://xaverric.cz";

const ROBOTS = "User-agent: *\nDisallow: /\n";

const routes = [
  { method: "GET", path: "/api/me", handler: getMe },
  { method: "GET", path: "/api/links", handler: getLinks },
  { method: "POST", path: "/api/links", handler: postLink, body: true },
  { method: "PATCH", path: "/api/links/:slug", handler: patchLink, body: true },
  { method: "DELETE", path: "/api/links/:slug", handler: removeLink },
  { method: "GET", path: "/api/links/:slug/stats", handler: getLinkStats },
  { method: "GET", path: "/auth/github", handler: startGithubLogin },
  { method: "GET", path: "/auth/github/callback", handler: finishGithubLogin },
  { method: "GET", path: "/auth/dev", handler: devLogin },
  { method: "POST", path: "/auth/logout", handler: logout },
];

const match = createRouter(routes);

const isWorkerPath = (pathname) => /^\/(api|auth)(\/|$)/.test(pathname);

const slugOf = (pathname) => {
  const slug = pathname.slice(1);
  return isSlug(slug) && !isReservedSlug(slug) ? slug : null;
};

const httpsUrl = (url) => {
  const secure = new URL(url);
  secure.protocol = "https:";
  return secure.href;
};

const serveAsset = async (request, env, path) => {
  const response = await env.ASSETS.fetch(path ? new Request(new URL(path, request.url), request) : request);
  return response.status === 404 ? notFoundPage() : response;
};

const handleWorkerPath = async (request, env, ctx, url, now) => {
  const found = match(request.method, url.pathname);
  if (found.status === 404) return errorResponse(404, "not_found", "Not found");
  if (found.status === 405) return errorResponse(405, "invalid_request", "Method not allowed", { allow: found.allow });
  const body = found.route.body ? await readJsonBody(request) : undefined;
  return found.route.handler({ request, env, url, params: found.params, body, now, ctx });
};

const handle = async (request, env, ctx) => {
  const url = new URL(request.url);
  const now = new Date();
  if (url.protocol === "http:" && !isLocalApp(env)) return redirect(httpsUrl(url), [], 301);
  await limitRequest(request, env, url.pathname);
  if (url.pathname === "/") return redirect(HOMEPAGE);
  if (url.pathname === "/robots.txt") return new Response(ROBOTS, { headers: { "content-type": "text/plain; charset=utf-8" } });
  if (url.pathname === "/admin" || url.pathname === "/admin/") return serveAsset(request, env, "/admin.html");
  if (isWorkerPath(url.pathname)) return handleWorkerPath(request, env, ctx, url, now);
  const slug = slugOf(url.pathname);
  if (!slug) return serveAsset(request, env);
  if (!["GET", "HEAD"].includes(request.method)) return errorResponse(405, "invalid_request", "Method not allowed", { allow: "GET, HEAD" });
  return followLink({ request, env, ctx, slug, now });
};

export default {
  async fetch(request, env, ctx) {
    const response = await handle(request, env, ctx).catch(toErrorResponse);
    const secured = withSecurityHeaders(response, request);
    return request.method === "HEAD" ? new Response(null, secured) : secured;
  },
};
