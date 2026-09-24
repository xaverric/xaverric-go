# xaverric-go

Personal URL shortener at https://go.xaverric.cz. One Cloudflare Worker with a D1 database and a small static admin page. Only the owner creates links.

- `GET /<slug>` answers `302` to the target (`Cache-Control: private, no-store`, `Referrer-Policy: no-referrer`). Unknown, expired and disabled slugs get a `noindex` 404 page.
- `GET /` redirects to https://xaverric.cz, `robots.txt` disallows everything, every response carries `X-Robots-Tag: noindex, nofollow`.
- Clicks are counted per day, country (`request.cf.country`) and referrer host. No IP addresses, user agents or full referrer URLs are stored. `HEAD` requests are not counted.
- `/admin` signs in with GitHub. Only GitHub user ids listed in `ADMIN_GITHUB_IDS` get a session.

## Layout

| Path | What |
|---|---|
| `src/` | Worker: routing, OAuth, sessions, links API, redirects |
| `public/` | Admin page, CSS, JS modules, self-hosted Geist fonts (OFL, `public/fonts/OFL.txt`) |
| `migrations/` | D1 schema |
| `test/` | Vitest suites running in the Workers runtime with the migrations applied |
| `docs/DEPLOY.md` | One-time owner setup and deploy |
| `docs/plan.md` | Design and test plan |

## Admin API

All routes need the session cookie and the owner id. Mutations also need a same-origin request.

| Method | Path | Body / query |
|---|---|---|
| GET | `/api/me` | |
| GET | `/api/links` | |
| POST | `/api/links` | `{ url, slug?, expiresAt? }`, random 6-character slug when `slug` is omitted |
| PATCH | `/api/links/:slug` | `{ url?, disabled?, expiresAt? }`, `expiresAt: null` clears the expiry |
| DELETE | `/api/links/:slug` | |
| GET | `/api/links/:slug/stats` | `?days=1..365`, default 30 |

Slugs are case-sensitive `[A-Za-z0-9_-]{1,64}`. Reserved: `admin`, `api`, `auth`, `assets`, `css`, `js`, `fonts`, `favicon.ico`, `favicon.svg`, `robots.txt`, `_headers`. Targets must be absolute `http` or `https` URLs of at most 2048 characters, without credentials and not on the shortener's own host.

## Local development

Node 22.

```sh
npm ci
npm run lint
npm test
```

Run the Worker locally with a dev login. Create `.dev.vars` (gitignored):

```sh
cat > .dev.vars <<VARS
SESSION_SECRET=$(openssl rand -hex 24)
DEV_LOGIN=1
APP_URL=http://localhost:8788
ADMIN_GITHUB_IDS=19148363
VARS
npx wrangler d1 migrations apply xaverric-go --local
npx wrangler dev --local --port 8788 --local-upstream localhost:8788
```

`--local-upstream` keeps the request host at `localhost`; without it the custom-domain route rewrites it to `go.xaverric.cz`. Then open http://localhost:8788/auth/dev?login=xaverric&next=/admin. The dev login only exists when `DEV_LOGIN=1` and `APP_URL` is `http://localhost`, and the dev user counts as admin only under the same condition.

## License

MIT
