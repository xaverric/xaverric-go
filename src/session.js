import { base64urlDecode, base64urlEncode, fromUtf8, utf8 } from "./encoding.js";
import { createToken, hashToken, isTokenFormat } from "./tokens.js";

export const SESSION_COOKIE = "go_session";
export const STATE_COOKIE = "go_oauth_state";
export const SESSION_MAX_AGE = 604800;
export const STATE_MAX_AGE = 600;
export const MIN_SECRET_LENGTH = 32;

export const isStrongSecret = (secret) => typeof secret === "string" && secret.length >= MIN_SECRET_LENGTH;

const hmacKey = (secret) => crypto.subtle.importKey("raw", utf8(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

export const signValue = async (payload, secret) => {
  if (!isStrongSecret(secret)) throw new Error("weak secret");
  const body = base64urlEncode(utf8(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), utf8(body));
  return `${body}.${base64urlEncode(signature)}`;
};

const parsePayload = (bytes) => {
  try {
    const value = JSON.parse(fromUtf8(bytes));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
};

export const verifyValue = async (value, secret, nowSec, typ) => {
  if (!isStrongSecret(secret) || typeof value !== "string" || value.length > 4096) return null;
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const signature = base64urlDecode(sig);
  const bytes = base64urlDecode(body);
  if (!body || !signature || !bytes || base64urlEncode(signature) !== sig) return null;
  const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret), signature, utf8(body));
  if (!valid) return null;
  const payload = parsePayload(bytes);
  if (!payload || !Number.isFinite(payload.exp) || payload.exp <= nowSec) return null;
  if (typ && payload.typ !== typ) return null;
  return payload;
};

export const equalStrings = (a, b) =>
  typeof a === "string" && typeof b === "string" && a.length === b.length && crypto.subtle.timingSafeEqual(utf8(a), utf8(b));

export const createSession = async (env, uid, nowSec, exp = nowSec + SESSION_MAX_AGE) => {
  const sid = createToken();
  const value = await signValue({ typ: "session", uid, sid, exp }, env.SESSION_SECRET);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM web_sessions WHERE expires_at <= ?1").bind(nowSec),
    env.DB.prepare("INSERT INTO web_sessions (token_hash, user_id, expires_at) VALUES (?1, ?2, ?3)").bind(await hashToken(sid), uid, exp),
  ]);
  return value;
};

export const findSessionUser = async (env, payload, nowSec) => {
  if (!Number.isSafeInteger(payload?.uid) || !isTokenFormat(payload?.sid)) return null;
  return env.DB.prepare(`SELECT u.id, u.github_id, u.login, u.name, u.avatar_url FROM web_sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?1 AND s.user_id = ?2 AND s.expires_at > ?3`)
    .bind(await hashToken(payload.sid), payload.uid, nowSec)
    .first();
};

export const revokeSession = async (env, value, nowSec) => {
  const payload = await verifyValue(value, env.SESSION_SECRET, nowSec, "session");
  if (!isTokenFormat(payload?.sid)) return;
  await env.DB.prepare("DELETE FROM web_sessions WHERE token_hash = ?1").bind(await hashToken(payload.sid)).run();
};
