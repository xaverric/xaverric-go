import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { call, insertLink, resetDb } from "./helpers.js";

const today = () => new Date().toISOString().slice(0, 10);

const link = (slug) => env.DB.prepare("SELECT * FROM links WHERE slug = ?1").bind(slug).first();

const dailyRows = (slug) => env.DB.prepare("SELECT * FROM clicks_daily WHERE slug = ?1 ORDER BY country, referrer_host").bind(slug).all().then((r) => r.results);

beforeEach(resetDb);

describe("GET /", () => {
  it("redirects to the homepage", async () => {
    const response = await call("GET", "/");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://xaverric.cz");
  });

  it("serves a robots.txt that disallows everything", async () => {
    const response = await call("GET", "/robots.txt");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("User-agent: *\nDisallow: /\n");
  });
});

describe("GET /<slug>", () => {
  it("redirects an active link without leaking the referrer", async () => {
    await insertLink("cv", "https://example.com/cv.pdf");
    const response = await call("GET", "/cv");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.com/cv.pdf");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("is case-sensitive", async () => {
    await insertLink("Cv", "https://example.com/");
    expect((await call("GET", "/cv")).status).toBe(404);
    expect((await call("GET", "/Cv")).status).toBe(302);
  });

  it("records the click with country and referrer host only", async () => {
    await insertLink("cv", "https://example.com/");
    const headers = { referer: "https://News.Example.org/some/private/path?q=secret", "user-agent": "Secret/1.0", "cf-connecting-ip": "203.0.113.9" };
    await call("GET", "/cv", { headers, cf: { country: "CZ" } });
    await call("GET", "/cv", { headers, cf: { country: "CZ" } });
    await call("GET", "/cv", { cf: { country: "DE" } });
    const row = await link("cv");
    expect(row.clicks).toBe(3);
    expect(row.last_click_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await dailyRows("cv")).toEqual([
      { slug: "cv", day: today(), country: "CZ", referrer_host: "news.example.org", count: 2 },
      { slug: "cv", day: today(), country: "DE", referrer_host: "", count: 1 },
    ]);
  });

  it("stores no IP, user agent or full referrer anywhere", async () => {
    await insertLink("cv", "https://example.com/");
    await call("GET", "/cv", { headers: { referer: "https://a.example/secret-path", "user-agent": "Secret/1.0", "cf-connecting-ip": "203.0.113.9" }, cf: { country: "CZ" } });
    const dump = JSON.stringify([await link("cv"), await dailyRows("cv")]);
    expect(dump).not.toMatch(/203\.0\.113\.9|Secret\/1\.0|secret-path/);
    const columns = await env.DB.prepare("SELECT name FROM pragma_table_info('clicks_daily')").all();
    expect(columns.results.map((c) => c.name)).toEqual(["slug", "day", "country", "referrer_host", "count"]);
  });

  it("ignores malformed country codes and non-http referrers", async () => {
    await insertLink("cv", "https://example.com/");
    await call("GET", "/cv", { headers: { referer: "android-app://com.example" }, cf: { country: "<script>" } });
    expect(await dailyRows("cv")).toMatchObject([{ country: "", referrer_host: "" }]);
  });

  it("redirects HEAD without counting it", async () => {
    await insertLink("cv", "https://example.com/");
    const response = await call("HEAD", "/cv");
    expect(response.status).toBe(302);
    expect((await link("cv")).clicks).toBe(0);
  });

  it.each([
    ["unknown", null],
    ["expired", { expiresAt: "2020-01-01T00:00:00.000Z" }],
    ["disabled", { disabledAt: "2026-01-01T00:00:00.000Z" }],
  ])("shows a noindex 404 page for a %s link", async (name, extra) => {
    if (extra) await insertLink(name, "https://example.com/", extra);
    const response = await call("GET", `/${name}`);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toMatch(/^text\/html/);
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    const html = await response.text();
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain("go.xaverric.cz");
    if (extra) expect((await link(name)).clicks).toBe(0);
  });

  it("keeps a link active until its expiry", async () => {
    await insertLink("soon", "https://example.com/", { expiresAt: new Date(Date.now() + 60000).toISOString() });
    expect((await call("GET", "/soon")).status).toBe(302);
  });

  it("serves reserved paths and nested paths from assets, not as slugs", async () => {
    await env.DB.prepare("INSERT INTO links (slug, url, created_at) VALUES ('css', 'https://example.com/', '2026-01-01')").run();
    expect((await call("GET", "/css")).status).toBe(404);
    expect(await (await call("GET", "/css/base.css")).text()).toBe("body{}");
    expect((await call("GET", "/nope/deeper")).status).toBe(404);
  });

  it("serves the admin page for /admin", async () => {
    const response = await call("GET", "/admin");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<title>admin</title>");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("rejects other methods on a slug", async () => {
    const response = await call("POST", "/cv");
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
  });
});
