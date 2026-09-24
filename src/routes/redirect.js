import { htmlPage } from "../http.js";
import { clickCountry, referrerHost } from "../links.js";
import { findActiveLink, recordClick } from "../queries.js";

export const PRIVATE_REDIRECT_HEADERS = { "cache-control": "private, no-store", "referrer-policy": "no-referrer" };

export const notFoundPage = () =>
  htmlPage(404, "Link not found", "This short link does not exist, has expired or was turned off.", { headers: { "referrer-policy": "no-referrer" } });

const logFailure = (error) => console.error("Click recording failed", error?.name ?? "Error", error?.message ?? "");

export const followLink = async ({ request, env, ctx, slug, now }) => {
  const nowIso = now.toISOString();
  const link = await findActiveLink(env.DB, slug, nowIso);
  if (!link) return notFoundPage();
  if (request.method === "GET") {
    const click = { slug, day: nowIso.slice(0, 10), country: clickCountry(request), referrer: referrerHost(request), nowIso };
    ctx.waitUntil(recordClick(env.DB, click).catch(logFailure));
  }
  return new Response(null, { status: 302, headers: { location: link.url, ...PRIVATE_REDIRECT_HEADERS } });
};
