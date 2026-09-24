import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_BODY_BYTES, SECURITY_HEADERS, readJsonBody } from "../src/http.js";
import { adminCookie, call, insertLink, resetDb } from "./helpers.js";

beforeEach(resetDb);

const parseHeadersFile = (text) =>
  Object.fromEntries(
    text
      .split("\n")
      .filter((line) => /^\s+\S/.test(line))
      .map((line) => line.trim().split(/:\s(.*)/s).slice(0, 2))
      .map(([name, value]) => [name.toLowerCase(), value]),
  );

describe("security headers", () => {
  it.each([
    ["redirect", "/cv"],
    ["root", "/"],
    ["404 page", "/missing"],
    ["admin page", "/admin"],
    ["asset", "/css/base.css"],
    ["api error", "/api/links"],
    ["robots", "/robots.txt"],
  ])("are set on the %s", async (name, path) => {
    await insertLink("cv", "https://example.com/");
    const response = await call("GET", path);
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: https://avatars.githubusercontent.com; font-src 'self'; connect-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'none'",
    );
    expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("referrer-policy")).toMatch(/^(no-referrer|strict-origin-when-cross-origin)$/);
  });

  it("keeps strict-origin-when-cross-origin outside redirects so same-origin mutations carry an Origin", async () => {
    expect((await call("GET", "/admin")).headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect((await call("GET", "/missing")).headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("_headers matches the Worker headers", () => {
    const file = parseHeadersFile(env.TEST_STATIC_HEADERS);
    expect(env.TEST_STATIC_HEADERS.startsWith("/*\n")).toBe(true);
    Object.entries(SECURITY_HEADERS).forEach(([name, value]) => expect(file[name]).toBe(value));
    expect(file["strict-transport-security"]).toBe("max-age=31536000; includeSubDomains");
  });

  it("strips the body of HEAD responses", async () => {
    const response = await call("HEAD", "/missing");
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });
});

describe("transport", () => {
  it("redirects plain http to https in production", async () => {
    const response = await call("GET", "http://go.xaverric.cz/cv");
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("https://go.xaverric.cz/cv");
  });
});

describe("rate limits", () => {
  it("limits auth and api routes by their own limiter", async () => {
    const denied = { limit: vi.fn().mockResolvedValue({ success: false }) };
    const auth = await call("GET", "/auth/github", { env: { AUTH_LIMITER: denied } });
    expect(auth.status).toBe(429);
    expect(auth.headers.get("retry-after")).toBe("60");
    expect((await call("GET", "/api/links", { env: { API_LIMITER: denied } })).status).toBe(429);
    expect(denied.limit).toHaveBeenCalledTimes(2);
  });

  it("does not limit redirects", async () => {
    await insertLink("cv", "https://example.com/");
    const denied = { limit: vi.fn().mockResolvedValue({ success: false }) };
    expect((await call("GET", "/cv", { env: { API_LIMITER: denied, AUTH_LIMITER: denied } })).status).toBe(302);
  });

  it("skips limiting when the bindings are absent", async () => {
    const cookie = await adminCookie();
    expect((await call("GET", "/api/links", { headers: { cookie }, env: { API_LIMITER: undefined } })).status).toBe(200);
  });
});

describe("bodies", () => {
  it("rejects oversized bodies", async () => {
    const cookie = await adminCookie();
    const response = await call("POST", "/api/links", { raw: JSON.stringify({ url: `https://example.com/${"a".repeat(MAX_BODY_BYTES)}` }), headers: { cookie, "content-type": "application/json" } });
    expect(response.status).toBe(413);
  });

  it("rejects invalid JSON", async () => {
    const request = new Request("https://go.xaverric.cz/api/links", { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
    await expect(readJsonBody(request)).rejects.toMatchObject({ status: 400 });
  });

  it("answers internal errors without details", async () => {
    const cookie = await adminCookie();
    const response = await call("GET", "/api/links", { headers: { cookie }, env: { DB: { prepare: () => { throw new Error("secret detail"); } } } });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret detail");
  });
});
