# xaverric-go - design and TDD plan

Personal URL shortener at https://go.xaverric.cz. One Cloudflare Worker, one D1 database, a static admin page. Only the owner creates links.

## Shape

```
src/
  index.js          request dispatch (https, rate limit, /, robots, /admin, /api, /auth, slug, assets)
  router.js         method + path matcher (from leaderborder)
  http.js           json/errors/redirect/body reader/security headers/html pages
  encoding.js       utf8 + base64url + hex (from leaderborder)
  tokens.js         random session ids + SHA-256 hashing
  session.js        HMAC-signed values, web_sessions rows
  cookies.js        __Host- cookies, local detection
  access.js         ADMIN_GITHUB_IDS parsing, admin check, dev admin
  auth.js           requireAdmin, same-origin check
  github.js         OAuth code exchange + app token check
  rate-limit.js     AUTH_LIMITER / API_LIMITER, skipped when absent
  links.js          slug + url + expiry validation, random slug, status
  queries.js        all D1 statements
  routes/web-auth.js  /auth/github, /auth/github/callback, /auth/dev, /auth/logout
  routes/links.js     /api/me, /api/links CRUD, /api/links/:slug/stats
  routes/redirect.js  GET|HEAD /<slug>
public/
  admin.html, css/{tokens,base,admin}.css, js/{admin,api,dom,toast,chart,format}.js, fonts/, favicon.svg, _headers
migrations/0001_init.sql
test/*.test.js
```

## Request dispatch (`run_worker_first = true`)

1. `http:` and not local -> 301 to https.
2. `/auth/*` -> AUTH_LIMITER, `/api/*` -> API_LIMITER (skipped when the binding is absent).
3. `/` -> 302 `https://xaverric.cz`. `/robots.txt` -> `Disallow: /`.
4. `/admin`, `/admin/` -> asset `/admin.html`.
5. `/api/*`, `/auth/*` -> router, JSON 404/405.
6. One path segment matching `[A-Za-z0-9_-]{1,64}` and not reserved -> redirect handler.
7. Anything else -> assets; an asset 404 becomes the branded 404 page.

Every response gets the security headers (CSP `default-src 'none'`, self-only script/style/font, avatars for img, HSTS on https, nosniff, DENY, COOP/CORP) and `X-Robots-Tag: noindex, nofollow`.

## Redirect

- Active = exists, `disabled_at IS NULL`, `expires_at IS NULL OR expires_at > now`.
- 302, `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer` (the destination sees neither the short link nor the page that linked it). The rest of the site keeps `strict-origin-when-cross-origin`, because `no-referrer` would turn the `Origin` of same-origin mutations into `null` and break the same-origin check.
- Only GET records a click (HEAD is a probe from unfurlers and monitors). Recording runs in `ctx.waitUntil`: `links.clicks + 1`, `last_click_at`, and an upsert into `clicks_daily (slug, day, country, referrer_host)`.
- Country = `request.cf.country` if it is two uppercase letters/digits, else `''`. Referrer = hostname of an `http(s)` `Referer`, lowercased, else `''`. No IP, no user agent, no full referrer URL.
- Unknown, expired, disabled -> 404 HTML page with `noindex`.

## Validation

- Slug: case-sensitive `^[A-Za-z0-9_-]{1,64}$`; reserved (case-insensitive): `admin api auth assets css js fonts favicon.ico favicon.svg robots.txt _headers`.
- Random slug: 6 chars from `23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ` (no look-alikes), rejection sampling, insert with `ON CONFLICT DO NOTHING`, up to 8 attempts.
- URL: string, trimmed, at most 2048 chars, absolute, `http:`/`https:`, no credentials, host not the app host. Stored normalized (`URL.href`).
- `expiresAt`: ISO 8601 with offset or `Z`, in the future, stored as `toISOString()`; `null` clears on PATCH.

## Auth

- GitHub OAuth web flow exactly like leaderborder: PKCE S256, HMAC-signed state cookie (10 min), code exchange, `POST /applications/{client_id}/token` to read the user.
- Admin = numeric GitHub id in `ADMIN_GITHUB_IDS`. Anyone else: 403 "Not allowed", no user row, no session.
- Session: HMAC-signed `__Host-go_session` cookie with a random id whose SHA-256 is stored in `web_sessions`, 7 days. Each API call re-checks the id against `ADMIN_GITHUB_IDS`, so removing an id locks the account out at once.
- Dev login: `/auth/dev?login=` only when `DEV_LOGIN=1` and `APP_URL` is `http://localhost`. Dev users get a negative GitHub id and count as admin only under the same condition.
- Mutations (`POST`, `PATCH`, `DELETE`, logout) require `Origin` = app origin, or `Sec-Fetch-Site: same-origin` without `Origin`.

## API

| Method | Path | Result |
|---|---|---|
| GET | `/api/me` | `{ login, name, avatarUrl }` |
| GET | `/api/links` | `{ links: [...] }` newest first |
| POST | `/api/links` | `{ url, slug?, expiresAt? }` -> 201 link, 409 slug taken |
| PATCH | `/api/links/:slug` | `{ url?, disabled?, expiresAt? }` -> link |
| DELETE | `/api/links/:slug` | 204 |
| GET | `/api/links/:slug/stats?days=30` | `{ days, total, series: [{ day, clicks }], countries, referrers }` |

Link JSON: `slug, url, shortUrl, createdAt, updatedAt, expiresAt, disabledAt, clicks, lastClickAt, status (active|disabled|expired)`. Errors: `{ error: { code, message } }`.

## Admin UI

Hallmark, compact: genre modern-minimal, tone utilitarian, macrostructure Index-First (the page is the list of links), nav N9 edge-aligned bar (leaderborder uses N5), footer Ft2 inline line. Theme: leaderborder's custom blue-signal tokens copied verbatim, Geist + Geist Mono self-hosted (OFL). One column on mobile, list + sticky detail panel from 64rem.

- Signed out: one card, "Sign in with GitHub".
- Create form: URL, optional slug, optional expiry; result line with the short link and a copy button.
- Search box filters by slug or target.
- Rows: slug, target (truncated), clicks, created, status tag; actions: Disable/Enable, Edit target (inline), Delete (optimistic, Undo toast, the DELETE is sent when the toast closes or the page hides).
- Detail panel: 30-day SVG bar chart (zero-filled), top countries, top referrers.
- States: loading skeleton, empty, error with retry.

## TDD order

1. `links.test.js` - slug, reserved, url, expiry validation, random slug alphabet/length.
2. `redirect.test.js` - `/` redirect, robots, 302 + headers, click recording (country, referrer host only, no IP/UA columns), HEAD does not count, expired/disabled/unknown -> 404 page.
3. `auth.test.js` - OAuth start/callback, non-admin 403 without session, admin by id not login, logout, dev login gating, session expiry.
4. `api.test.js` - anon 401, non-admin 403, same-origin, CRUD, 409, random slug uniqueness and collision retry, stats zero-filled.
5. `security.test.js` - security headers on every kind of response, `_headers` matches the Worker, rate limit 429, body limits.

Run: `npm run lint`, `npm test`, then `wrangler d1 migrations apply --local` and `wrangler dev` with `.dev.vars` for a browser check at 375 and 1280 px.
