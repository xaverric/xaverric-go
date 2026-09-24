import { isLocalApp } from "./cookies.js";

const GITHUB_ID = /^[1-9][0-9]{0,15}$/;

export const adminIds = (env) =>
  (env.ADMIN_GITHUB_IDS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => GITHUB_ID.test(item))
    .map(Number);

export const devLoginAllowed = (env) => env.DEV_LOGIN === "1" && isLocalApp(env) && new URL(env.APP_URL).hostname === "localhost";

export const isAdmin = (githubId, env) =>
  Number.isSafeInteger(githubId) && (adminIds(env).includes(githubId) || (githubId < 0 && devLoginAllowed(env)));
