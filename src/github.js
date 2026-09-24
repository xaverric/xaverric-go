import { HttpError } from "./http.js";

const USER_AGENT = "xaverric-go";

const GITHUB_LOGIN = /^[A-Za-z0-9-]{1,39}$/;

export const isGithubLogin = (value) => typeof value === "string" && GITHUB_LOGIN.test(value);

const avatarUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "avatars.githubusercontent.com" ? url.href : null;
  } catch {
    return null;
  }
};

const toProfile = (user) => {
  if (!Number.isSafeInteger(user?.id) || !isGithubLogin(user.login)) throw new HttpError(500, "internal", "GitHub returned an unexpected user");
  return { githubId: user.id, login: user.login, name: user.name || user.login, avatarUrl: avatarUrl(user.avatar_url) };
};

export const getGithubUser = async (token, env) => {
  const response = await fetch(`https://api.github.com/applications/${env.GITHUB_CLIENT_ID}/token`, {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": USER_AGENT,
      authorization: `Basic ${btoa(`${env.GITHUB_CLIENT_ID}:${env.GITHUB_CLIENT_SECRET}`)}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ access_token: token }),
  });
  if (response.status === 404) throw new HttpError(401, "unauthorized", "GitHub token rejected");
  if (!response.ok) throw new HttpError(500, "internal", `GitHub responded ${response.status}`);
  return toProfile((await response.json()).user);
};

export const exchangeCode = async ({ code, verifier, redirectUri, env }) => {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
    headers: { accept: "application/json", "content-type": "application/json", "user-agent": USER_AGENT },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, code_verifier: verifier, redirect_uri: redirectUri }),
  });
  if (!response.ok) return null;
  const data = await response.json();
  return typeof data.access_token === "string" ? data.access_token : null;
};
