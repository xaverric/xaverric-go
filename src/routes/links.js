import { requireAdmin } from "../auth.js";
import { HttpError, badRequest, json, noContent } from "../http.js";
import { parseExpiry, randomSlug, toLink, validateSlug, validateTarget } from "../links.js";
import { deleteLink, getLink, insertLink, linkStats, listLinks, updateLink } from "../queries.js";

const RANDOM_ATTEMPTS = 8;
const DAY_MS = 86400000;
const PATCH_FIELDS = new Set(["url", "disabled", "expiresAt"]);
const CREATE_FIELDS = new Set(["url", "slug", "expiresAt"]);

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const notFound = () => new HttpError(404, "not_found", "Link not found");

const unwrap = (result) => {
  if (result.error) throw badRequest(result.error);
  return result;
};

const assertFields = (body, allowed) => {
  if (!isObject(body)) throw badRequest("body: must be a JSON object");
  const unknown = Object.keys(body).find((key) => !allowed.has(key));
  if (unknown) throw badRequest(`${unknown}: unknown field`);
};

export const getMe = async (context) => {
  const user = await requireAdmin(context);
  return json({ login: user.login, name: user.name, avatarUrl: user.avatar_url });
};

export const getLinks = async (context) => {
  await requireAdmin(context);
  const rows = await listLinks(context.env.DB);
  return json({ links: rows.map((row) => toLink(row, context.env, context.now)) });
};

const insertRandom = async (db, fields) => {
  for (let attempt = 0; attempt < RANDOM_ATTEMPTS; attempt++) {
    const row = await insertLink(db, { ...fields, slug: randomSlug() });
    if (row) return row;
  }
  throw new HttpError(503, "unavailable", "Could not find a free slug, try again");
};

export const postLink = async (context) => {
  await requireAdmin(context);
  const { body, env, now } = context;
  assertFields(body, CREATE_FIELDS);
  const { url } = unwrap(validateTarget(body.url, env.APP_URL));
  const { value: expiresAt } = body.expiresAt === undefined ? { value: null } : unwrap(parseExpiry(body.expiresAt, now));
  const fields = { url, expiresAt, nowIso: now.toISOString() };
  if (body.slug === undefined || body.slug === "") return json(toLink(await insertRandom(env.DB, fields), env, now), { status: 201 });
  const slugError = validateSlug(body.slug);
  if (slugError) throw badRequest(slugError);
  const row = await insertLink(env.DB, { ...fields, slug: body.slug });
  if (!row) throw new HttpError(409, "conflict", "slug: already taken");
  return json(toLink(row, env, now), { status: 201 });
};

const parsePatch = (body, env, now) => {
  assertFields(body, PATCH_FIELDS);
  if (Object.keys(body).length === 0) throw badRequest("body: nothing to change");
  if (body.disabled !== undefined && typeof body.disabled !== "boolean") throw badRequest("disabled: must be a boolean");
  return {
    url: body.url === undefined ? undefined : unwrap(validateTarget(body.url, env.APP_URL)).url,
    disabled: body.disabled,
    expiresAt: body.expiresAt === undefined ? undefined : unwrap(parseExpiry(body.expiresAt, now)).value,
  };
};

export const patchLink = async (context) => {
  await requireAdmin(context);
  const { env, now } = context;
  const row = await updateLink(env.DB, context.params.slug, parsePatch(context.body, env, now), now.toISOString());
  if (!row) throw notFound();
  return json(toLink(row, env, now));
};

export const removeLink = async (context) => {
  await requireAdmin(context);
  if (!(await deleteLink(context.env.DB, context.params.slug))) throw notFound();
  return noContent();
};

const parseDays = (value) => {
  if (value === null) return 30;
  const days = /^\d{1,3}$/.test(value) ? Number(value) : NaN;
  if (!(days >= 1 && days <= 365)) throw badRequest("days: must be an integer from 1 to 365");
  return days;
};

const dayList = (days, now) => Array.from({ length: days }, (_, i) => new Date(now.getTime() - (days - 1 - i) * DAY_MS).toISOString().slice(0, 10));

export const getLinkStats = async (context) => {
  await requireAdmin(context);
  const { env, now, params, url } = context;
  const days = parseDays(url.searchParams.get("days"));
  const link = await getLink(env.DB, params.slug);
  if (!link) throw notFound();
  const range = dayList(days, now);
  const stats = await linkStats(env.DB, params.slug, range[0]);
  const byDay = new Map(stats.daily.map((row) => [row.day, row.clicks]));
  const series = range.map((day) => ({ day, clicks: byDay.get(day) ?? 0 }));
  return json({
    days,
    total: series.reduce((sum, point) => sum + point.clicks, 0),
    allTime: link.clicks,
    series,
    countries: stats.countries,
    referrers: stats.referrers,
  });
};
