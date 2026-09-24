import { describe, expect, it } from "vitest";
import { SLUG_ALPHABET, isReservedSlug, isSlug, linkStatus, parseExpiry, randomSlug, validateTarget } from "../src/links.js";

const NOW = new Date("2026-09-24T12:00:00Z");
const APP = "https://go.xaverric.cz";

describe("slugs", () => {
  it.each(["a", "Abc_123-x", "x".repeat(64)])("accepts %s", (slug) => expect(isSlug(slug)).toBe(true));

  it.each(["", "x".repeat(65), "a.b", "a/b", "a b", "é", "%61", null, 5])("rejects %s", (slug) => expect(isSlug(slug)).toBe(false));

  it.each(["admin", "api", "auth", "assets", "css", "js", "favicon.ico", "robots.txt", "_headers", "Admin", "API"])("reserves %s", (slug) =>
    expect(isReservedSlug(slug)).toBe(true));

  it("does not reserve ordinary slugs", () => expect(isReservedSlug("cv")).toBe(false));

  it("generates 6 characters from the safe alphabet", () => {
    const slugs = Array.from({ length: 500 }, () => randomSlug());
    expect(slugs.every((slug) => slug.length === 6 && [...slug].every((c) => SLUG_ALPHABET.includes(c)))).toBe(true);
    expect(new Set(slugs).size).toBe(500);
    expect(SLUG_ALPHABET).not.toMatch(/[0O1lI]/);
  });
});

describe("targets", () => {
  it("normalizes a valid https url", () => expect(validateTarget(" https://Example.com/a?b=1#c ", APP)).toEqual({ url: "https://example.com/a?b=1#c" }));

  it("accepts http", () => expect(validateTarget("http://example.com", APP).url).toBe("http://example.com/"));

  it.each([
    ["javascript:alert(1)"],
    ["data:text/html,hi"],
    ["ftp://example.com/file"],
    ["/relative/path"],
    ["example.com"],
    ["https://user:pass@example.com/"],
    ["https://go.xaverric.cz/abc"],
    ["https://GO.xaverric.cz./abc"],
    [`https://example.com/${"a".repeat(2048)}`],
    [""],
    [42],
  ])("rejects %s", (value) => expect(validateTarget(value, APP).error).toMatch(/^url: /));
});

describe("expiry", () => {
  it("accepts a future ISO timestamp", () => expect(parseExpiry("2026-10-01T10:00:00+02:00", NOW)).toEqual({ value: "2026-10-01T08:00:00.000Z" }));

  it.each(["2026-09-01T00:00:00Z", "tomorrow", "2026-13-01T00:00:00Z", "2026-10-01", 123])("rejects %s", (value) =>
    expect(parseExpiry(value, NOW).error).toMatch(/^expiresAt: /));

  it("passes null through", () => expect(parseExpiry(null, NOW)).toEqual({ value: null }));
});

describe("status", () => {
  it("derives active, disabled and expired", () => {
    expect(linkStatus({ disabled_at: null, expires_at: null }, NOW)).toBe("active");
    expect(linkStatus({ disabled_at: "2026-09-01T00:00:00.000Z", expires_at: null }, NOW)).toBe("disabled");
    expect(linkStatus({ disabled_at: null, expires_at: "2026-09-24T11:59:59.000Z" }, NOW)).toBe("expired");
    expect(linkStatus({ disabled_at: null, expires_at: "2026-09-24T12:00:01.000Z" }, NOW)).toBe("active");
  });
});
