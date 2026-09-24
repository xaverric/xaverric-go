import { base64urlEncode, hex, utf8 } from "./encoding.js";

const TOKEN_PATTERN = /^go_[A-Za-z0-9_-]{43}$/;

export const createToken = () => `go_${base64urlEncode(crypto.getRandomValues(new Uint8Array(32)))}`;

export const hashToken = async (token) => hex(await crypto.subtle.digest("SHA-256", utf8(token)));

export const isTokenFormat = (token) => typeof token === "string" && TOKEN_PATTERN.test(token);
