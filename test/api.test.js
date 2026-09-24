import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ORIGIN, adminCookie, call, insertLink, insertUser, resetDb, sessionCookie } from "./helpers.js";

let cookie;

const as = (headers = {}) => ({ headers: { cookie, ...headers } });

const post = (body, headers) => call("POST", "/api/links", { body, ...as(headers) });

const patch = (slug, body) => call("PATCH", `/api/links/${slug}`, { body, ...as() });

const dayOffset = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

beforeEach(async () => {
  await resetDb();
  cookie = await adminCookie();
});

afterEach(() => vi.restoreAllMocks());

describe("access", () => {
  it.each([
    ["GET", "/api/me"],
    ["GET", "/api/links"],
    ["POST", "/api/links"],
    ["PATCH", "/api/links/x"],
    ["DELETE", "/api/links/x"],
    ["GET", "/api/links/x/stats"],
  ])("%s %s is 401 anonymously", async (method, path) => {
    const response = await call(method, path, { body: method === "GET" || method === "DELETE" ? undefined : {} });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "unauthorized", message: "Authentication required" } });
  });

  it("is 403 for a signed-in user who is not the admin", async () => {
    const other = await sessionCookie(await insertUser(42, "someone"));
    expect((await call("GET", "/api/links", { headers: { cookie: other } })).status).toBe(403);
    expect((await call("POST", "/api/links", { body: { url: "https://example.com" }, headers: { cookie: other } })).status).toBe(403);
  });

  it("checks the admin by GitHub id, not by login", async () => {
    await resetDb();
    const impostor = await sessionCookie(await insertUser(7, "xaverric"));
    expect((await call("GET", "/api/me", { headers: { cookie: impostor } })).status).toBe(403);
    const renamed = await sessionCookie(await insertUser(19148363, "new-name"));
    const me = await call("GET", "/api/me", { headers: { cookie: renamed } });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ login: "new-name" });
  });

  it("rejects cross-origin mutations", async () => {
    await insertLink("cv", "https://example.com/");
    expect((await post({ url: "https://example.com" }, { origin: "https://evil.com" })).status).toBe(403);
    expect((await call("DELETE", "/api/links/cv", as({ origin: "null" }))).status).toBe(403);
    expect((await call("PATCH", "/api/links/cv", { body: { disabled: true }, ...as({ origin: "https://go.xaverric.cz.evil.com" }) })).status).toBe(403);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM links").first()).n).toBe(1);
  });

  it("accepts same-origin fetch metadata without an Origin header", async () => {
    const response = await call("POST", "/api/links", { body: { url: "https://example.com" }, headers: { cookie, origin: undefined, "sec-fetch-site": "same-origin" } });
    expect(response.status).toBe(201);
  });
});

describe("POST /api/links", () => {
  it("creates a link with a chosen slug", async () => {
    const response = await post({ url: "https://example.com/talk", slug: "Talk-2026", expiresAt: "2099-01-01T00:00:00Z" });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      slug: "Talk-2026",
      url: "https://example.com/talk",
      shortUrl: `${ORIGIN}/Talk-2026`,
      expiresAt: "2099-01-01T00:00:00.000Z",
      disabledAt: null,
      clicks: 0,
      lastClickAt: null,
      status: "active",
    });
    expect((await call("GET", "/Talk-2026")).headers.get("location")).toBe("https://example.com/talk");
  });

  it("generates a unique random slug when none is given", async () => {
    const slugs = [];
    for (let i = 0; i < 20; i++) slugs.push((await (await post({ url: `https://example.com/${i}` })).json()).slug);
    expect(slugs.every((slug) => /^[2-9a-km-zA-HJ-NP-Z]{6}$/.test(slug))).toBe(true);
    expect(new Set(slugs).size).toBe(20);
  });

  it("retries on a random slug collision", async () => {
    await insertLink("222222", "https://example.com/taken");
    const real = crypto.getRandomValues.bind(crypto);
    let calls = 0;
    vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => (calls++ === 0 ? array.fill(0) : real(array)));
    const response = await post({ url: "https://example.com/new" });
    expect(response.status).toBe(201);
    const { slug } = await response.json();
    expect(slug).not.toBe("222222");
    expect((await env.DB.prepare("SELECT url FROM links WHERE slug = '222222'").first()).url).toBe("https://example.com/taken");
  });

  it("is 409 when the chosen slug is taken", async () => {
    await insertLink("cv", "https://example.com/");
    const response = await post({ url: "https://example.org", slug: "cv" });
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("conflict");
  });

  it.each([
    [{ url: "javascript:alert(1)" }, "url: "],
    [{ url: "data:text/html,hi" }, "url: "],
    [{ url: "/relative" }, "url: "],
    [{ url: "https://go.xaverric.cz/cv" }, "url: "],
    [{ url: "https://example.com", slug: "admin" }, "slug: "],
    [{ url: "https://example.com", slug: "API" }, "slug: "],
    [{ url: "https://example.com", slug: "a/b" }, "slug: "],
    [{ url: "https://example.com", expiresAt: "2001-01-01T00:00:00Z" }, "expiresAt: "],
    [[], "body: "],
  ])("rejects %j", async (body, prefix) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect((await response.json()).error.message.startsWith(prefix)).toBe(true);
  });

  it("requires a JSON body", async () => {
    expect((await call("POST", "/api/links", { raw: "url=x", headers: { cookie, "content-type": "application/x-www-form-urlencoded" } })).status).toBe(400);
  });
});

describe("GET /api/links", () => {
  it("lists links newest first with status and clicks", async () => {
    await insertLink("old", "https://example.com/old", { createdAt: "2026-01-01T00:00:00.000Z", clicks: 5 });
    await insertLink("off", "https://example.com/off", { createdAt: "2026-02-01T00:00:00.000Z", disabledAt: "2026-02-02T00:00:00.000Z" });
    await insertLink("gone", "https://example.com/gone", { createdAt: "2026-03-01T00:00:00.000Z", expiresAt: "2026-03-02T00:00:00.000Z" });
    const response = await call("GET", "/api/links", as());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { links } = await response.json();
    expect(links.map((l) => [l.slug, l.status, l.clicks])).toEqual([["gone", "expired", 0], ["off", "disabled", 0], ["old", "active", 5]]);
    expect(links[2]).toMatchObject({ url: "https://example.com/old", createdAt: "2026-01-01T00:00:00.000Z", shortUrl: `${ORIGIN}/old`, lastClickAt: null });
  });

  it("returns an empty list", async () => {
    expect(await (await call("GET", "/api/links", as())).json()).toEqual({ links: [] });
  });
});

describe("PATCH /api/links/:slug", () => {
  beforeEach(() => insertLink("cv", "https://example.com/"));

  it("changes the target", async () => {
    const response = await patch("cv", { url: "https://example.org/new" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ url: "https://example.org/new", status: "active" });
    expect(body.updatedAt).toMatch(/^\d{4}-/);
  });

  it("disables and enables", async () => {
    expect(await (await patch("cv", { disabled: true })).json()).toMatchObject({ status: "disabled" });
    expect((await call("GET", "/cv")).status).toBe(404);
    expect(await (await patch("cv", { disabled: false })).json()).toMatchObject({ status: "active", disabledAt: null });
    expect((await call("GET", "/cv")).status).toBe(302);
  });

  it("sets and clears the expiry", async () => {
    expect(await (await patch("cv", { expiresAt: "2099-01-01T00:00:00Z" })).json()).toMatchObject({ expiresAt: "2099-01-01T00:00:00.000Z" });
    expect(await (await patch("cv", { expiresAt: null })).json()).toMatchObject({ expiresAt: null });
  });

  it.each([[{}], [{ disabled: "yes" }], [{ url: "javascript:x" }], [{ expiresAt: "soon" }], [{ slug: "new" }]])("rejects %j", async (body) => {
    expect((await patch("cv", body)).status).toBe(400);
  });

  it("is 404 for an unknown slug", async () => {
    expect((await patch("nope", { disabled: true })).status).toBe(404);
  });
});

describe("DELETE /api/links/:slug", () => {
  it("deletes the link and its stats", async () => {
    await insertLink("cv", "https://example.com/");
    await call("GET", "/cv", { cf: { country: "CZ" } });
    expect((await call("DELETE", "/api/links/cv", as())).status).toBe(204);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM links").first()).n).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM clicks_daily").first()).n).toBe(0);
    expect((await call("DELETE", "/api/links/cv", as())).status).toBe(404);
  });
});

describe("GET /api/links/:slug/stats", () => {
  const seed = (day, country, referrer, count) =>
    env.DB.prepare("INSERT INTO clicks_daily (slug, day, country, referrer_host, count) VALUES ('cv', ?1, ?2, ?3, ?4)").bind(day, country, referrer, count).run();

  beforeEach(async () => {
    await insertLink("cv", "https://example.com/", { clicks: 20 });
    await seed(dayOffset(0), "CZ", "t.co", 3);
    await seed(dayOffset(0), "DE", "", 1);
    await seed(dayOffset(-2), "CZ", "", 4);
    await seed(dayOffset(-40), "US", "old.example", 12);
  });

  it("returns a zero-filled daily series with top countries and referrers", async () => {
    const response = await call("GET", "/api/links/cv/stats", as());
    expect(response.status).toBe(200);
    const stats = await response.json();
    expect(stats.days).toBe(30);
    expect(stats.total).toBe(8);
    expect(stats.allTime).toBe(20);
    expect(stats.series).toHaveLength(30);
    expect(stats.series[0].day).toBe(dayOffset(-29));
    expect(stats.series.at(-1)).toEqual({ day: dayOffset(0), clicks: 4 });
    expect(stats.series.at(-2)).toEqual({ day: dayOffset(-1), clicks: 0 });
    expect(stats.series.at(-3)).toEqual({ day: dayOffset(-2), clicks: 4 });
    expect(stats.countries).toEqual([{ key: "CZ", clicks: 7 }, { key: "DE", clicks: 1 }]);
    expect(stats.referrers).toEqual([{ key: "", clicks: 5 }, { key: "t.co", clicks: 3 }]);
  });

  it("honours the days parameter", async () => {
    const stats = await (await call("GET", "/api/links/cv/stats?days=90", as())).json();
    expect(stats.series).toHaveLength(90);
    expect(stats.total).toBe(20);
  });

  it.each([["0"], ["366"], ["abc"], ["7.5"]])("rejects days=%s", async (days) => {
    expect((await call("GET", `/api/links/cv/stats?days=${days}`, as())).status).toBe(400);
  });

  it("is 404 for an unknown slug", async () => {
    expect((await call("GET", "/api/links/nope/stats", as())).status).toBe(404);
  });
});

describe("GET /api/me", () => {
  it("returns the admin profile", async () => {
    expect(await (await call("GET", "/api/me", as())).json()).toEqual({ login: "xaverric", name: "xaverric", avatarUrl: null });
  });
});

describe("unknown api routes", () => {
  it("answers JSON 404 and 405", async () => {
    expect((await call("GET", "/api/nope", as())).status).toBe(404);
    const response = await call("PUT", "/api/links", as());
    expect(response.status).toBe(405);
    expect((await response.json()).error.code).toBe("invalid_request");
  });
});
