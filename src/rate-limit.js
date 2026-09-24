import { HttpError } from "./http.js";

const limiterFor = (env, pathname) => {
  if (pathname.startsWith("/auth/")) return env.AUTH_LIMITER;
  if (pathname.startsWith("/api/")) return env.API_LIMITER;
  return null;
};

export const limitRequest = async (request, env, pathname) => {
  const limiter = limiterFor(env, pathname);
  if (!limiter) return;
  if (!(await limiter.limit({ key: request.headers.get("cf-connecting-ip") || "local" })).success) {
    throw new HttpError(429, "rate_limited", "Too many requests, retry later", { "retry-after": "60" });
  }
};
