export const isLocalApp = (env) => {
  try {
    const url = new URL(env.APP_URL);
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
};

export const cookieName = (name, env) => (isLocalApp(env) ? name : `__Host-${name}`);

export const parseCookies = (header) =>
  Object.fromEntries(
    (header ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part.includes("="))
      .map((part) => {
        const at = part.indexOf("=");
        return [part.slice(0, at).trim(), part.slice(at + 1).trim()];
      }),
  );

export const serializeCookie = (name, value, { maxAge, path = "/", httpOnly = true, secure = true, sameSite = "Lax" }) =>
  [`${name}=${value}`, `Path=${path}`, `Max-Age=${maxAge}`, httpOnly && "HttpOnly", secure && "Secure", `SameSite=${sameSite}`].filter(Boolean).join("; ");
