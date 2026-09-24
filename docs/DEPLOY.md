# Deploying go.xaverric.cz

Pushes to `main` run **Deploy** (`.github/workflows/deploy.yml`): lint and tests, then in the GitHub environment `production` `wrangler d1 migrations apply xaverric-go --remote` and `wrangler deploy`. Without the Cloudflare secrets the deploy job ends with a "Deploy skipped" notice. A manual run (`workflow_dispatch`) deploys only from `main`.

The D1 database `xaverric-go` (`9e6a714e-e575-4f48-bafd-1563ef7686cd`) and the custom domain `go.xaverric.cz` are declared in `wrangler.toml`.

## One-time setup

### 1. GitHub OAuth App

GitHub > Settings > Developer settings > OAuth Apps > New OAuth App:

| Field | Value |
|---|---|
| Application name | go.xaverric.cz |
| Homepage URL | `https://go.xaverric.cz` |
| Authorization callback URL | `https://go.xaverric.cz/auth/github/callback` |
| Enable Device Flow | off |

Copy the Client ID into `GITHUB_CLIENT_ID` under `[vars]` in `wrangler.toml` and commit it (it is public). Generate a client secret and keep it in the clipboard for the next step. The app requests no scopes.

### 2. Worker secrets

From the repository root. `wrangler secret put` reads the value from stdin, so nothing lands in the shell history:

```sh
pbpaste | npx wrangler secret put GITHUB_CLIENT_SECRET
openssl rand -base64 32 | npx wrangler secret put SESSION_SECRET
gh api user --jq .id | npx wrangler secret put ADMIN_GITHUB_IDS
```

- `SESSION_SECRET` must have at least 32 characters, the Worker refuses shorter values. Rotating it signs every session out.
- `ADMIN_GITHUB_IDS` is a comma-separated list of numeric GitHub user ids (`19148363` for `xaverric`). Ids are immutable, so a renamed or recycled login cannot take over. Anyone else who signs in gets "Not allowed" and no session. Removing an id locks its sessions out on the next request.

Clear the clipboard after pasting the client secret.

### 3. Cloudflare API token

Cloudflare dashboard > My Profile > API Tokens > Create Token > template **Edit Cloudflare Workers**, adjusted to:

| Scope | Permission | Why |
|---|---|---|
| Account > Workers Scripts | Edit | `wrangler deploy` (script and static assets) |
| Account > D1 | Edit | `wrangler d1 migrations apply --remote` |
| Account > Account Settings | Read | wrangler account lookup |
| User > User Details | Read | wrangler account lookup |
| Zone > Zone | Read | custom domain `go.xaverric.cz` |
| Zone > Workers Routes | Edit | custom domain route in `wrangler.toml` |

Account Resources: only your account. Zone Resources: only `xaverric.cz`. Set an expiry and rotate it regularly.

### 4. GitHub environment `production`

Create the environment with a branch policy that allows only `main` (no manual approval, merges to `main` deploy automatically):

```sh
gh api -X PUT repos/xaverric/xaverric-go/environments/production \
  -F "deployment_branch_policy[protected_branches]=false" \
  -F "deployment_branch_policy[custom_branch_policies]=true"
gh api -X POST repos/xaverric/xaverric-go/environments/production/deployment-branch-policies -f name=main -f type=branch
```

Store the Cloudflare values as environment secrets (never repository secrets). `gh secret set` reads from stdin when `--body` is omitted:

```sh
pbpaste | gh secret set CLOUDFLARE_API_TOKEN --env production --repo xaverric/xaverric-go
gh secret set CLOUDFLARE_ACCOUNT_ID --env production --repo xaverric/xaverric-go
```

### 5. First deploy

Push to `main` (or run **Deploy** manually) and approve the `production` deployment in the run. Check:

```sh
curl -sI https://go.xaverric.cz/ | grep -i location          # https://xaverric.cz
curl -s https://go.xaverric.cz/robots.txt
```

Then sign in at https://go.xaverric.cz/admin.

## Rate limits

`AUTH_LIMITER` (30 requests per minute per IP) guards `/auth/*`, `API_LIMITER` (300 per minute) guards `/api/*`. Redirects are not limited. The namespaces `2001` and `2002` are account-wide and must not collide with other Workers (leaderborder uses `1001` to `1003`).

## Rollback

```sh
npx wrangler deployments list
npx wrangler rollback
```

D1 migrations are forward only. Undo a schema change with a new migration, or restore with D1 Time Travel:

```sh
npx wrangler d1 time-travel restore xaverric-go --timestamp "<ISO time before the deploy>"
```
