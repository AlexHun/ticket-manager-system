# Deploying to Railway

Three services in one Railway project, from one GitHub repo:

| Service | What it is | Built by |
|---|---|---|
| `postgres` | Railway's Postgres | Railway template |
| `api` | Express + Bun, long-lived; also runs the pg-boss workers | `apps/api/Dockerfile` |
| `web` | The built SPA, served by Caddy — and the public front door for the API | `apps/web/Dockerfile` |

`web` proxies `/api/*` to `api` over Railway's private network, so the browser
only ever talks to one origin. That is a **cookie** decision: sessions are
cookies and `up.railway.app` is on the Public Suffix List, so two Railway
domains are two *sites*, and a session that has to span them is a third-party
cookie that Chrome incognito and Safari drop. See
[Cookies](#cookies-read-this-before-the-first-login).

Both images build from the **repository root** — `@ticket/core` and `@ticket/shared`
are workspace dependencies, so a build context scoped to one app could not see
them. Each service is pointed at its own Dockerfile instead of using Railway's
Root Directory setting, which would scope the context and break the install.

Dockerfiles rather than Railway's automatic builder because **Railpack does not
detect Bun projects**; a Bun app on Railway has to bring its own image.

---

## 1. Create the project

```bash
railway login
railway init                 # or create the project in the dashboard
railway add --database postgres
```

Then create two empty services from the repo (dashboard → *New* → *GitHub Repo*,
same repo twice) and name them `api` and `web`.

## 2. Point each service at its config

Railway's config-as-code path is **absolute from the repo root and does not
follow the Root Directory**, so a single `railway.json` at the root would apply
to both services. Each service therefore carries its own file, and each has to be
told where it is — *Service → Settings → Config as code*:

| Service | Config path |
|---|---|
| `api` | `/apps/api/railway.json` |
| `web` | `/apps/web/railway.json` |

Leave **Root Directory empty on both.**

Those files set the builder, the Dockerfile path, the healthcheck, the restart
policy, and — for `api` — the pre-deploy migration command. They also set
`watchPatterns`, so a change under `apps/web/` does not rebuild the API.

## 3. Variables

### `api`

| Variable | Value | Notes |
|---|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Reference variable. pg-boss opens its own small pool against the same string, in its own `pgboss` schema. |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` | Validated at boot: ≥32 chars or the process refuses to start. |
| `BETTER_AUTH_URL` | `https://<web-domain>` | The origin the **browser** reaches this API on. Behind the `/api/*` proxy that is the *web* service's domain, not this one's — and it is what tells the API it is same-origin and may keep `SameSite=Lax`. |
| `TRUSTED_ORIGINS` | `https://<web-domain>` | The web service's public URL. Drives both CORS and Better Auth's origin check; an origin missing here cannot sign in. |
| `COOKIE_DOMAIN` | *(empty)* | See [Cookies](#cookies-read-this-before-the-first-login) below. Empty is correct behind the proxy. |
| `INBOUND_EMAIL_WEBHOOK_USERNAME` / `_PASSWORD` | your choice | Empty values reject every webhook request. |
| `OPENAI_API_KEY` | your key | Optional. Empty ⇒ the two AI endpoints answer 503 and new tickets stay uncategorised in `New`. |
| `AUTO_REPLY_ENABLED` | `true` / `false` | The kill switch for the one feature that writes to customers unattended. |
| `PIPELINE_SIMULATOR_ENABLED` | `false` unless wanted | Default off; only the literal `"true"` turns it on. |
| `SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE` | optional | Unset ⇒ the SDK never initialises. |

`PORT` and `NODE_ENV` are **not** set here: Railway injects `PORT`, and the
Dockerfile pins `NODE_ENV=production` so that secure cookies, the rate limiter
and the seed script's production behaviour cannot depend on a dashboard field
someone forgot.

### `web`

Everything Vite bakes into the bundle. These are **build-time** values — each is
declared as an `ARG` in `apps/web/Dockerfile`, which is what opts a Railway
variable into the build. Changing one requires a **rebuild**, not a redeploy.

| Variable | Value |
|---|---|
| `VITE_API_URL` | ***(empty)*** — the app calls `/api/*` on its own origin |
| `VITE_SENTRY_DSN` | optional |
| `VITE_SENTRY_TRACES_SAMPLE_RATE` | optional, defaults to 0 |
| `VITE_SENTRY_ENVIRONMENT` | optional; set to `staging` for a non-production build |
| `VITE_SENTRY_RELEASE` | `web@0.0.0+${{RAILWAY_GIT_COMMIT_SHA}}` — recommended |

`VITE_SENTRY_RELEASE` is worth setting because `.git` is excluded from the build
context, so `releaseName()` in `vite.config.ts` cannot ask git for a commit and
falls back to a version with no sha in it.

`web` needs one **runtime** variable as well, which is not a Vite value and is
not baked into the bundle:

| Variable | Value |
|---|---|
| `API_UPSTREAM` | `${{<api-service>.RAILWAY_PRIVATE_DOMAIN}}:3001` |

That is what the Caddyfile's `handle /api/*` block proxies to. A reference
variable rather than a literal so it cannot go stale; private networking is
IPv6-only and the API binds `::`, so the hop never leaves Railway's network. The
API keeps its own public domain regardless — Postmark's webhook still calls it
directly rather than through here.

There is a chicken-and-egg here: each service needs the other's domain. Generate
both domains first (*Settings → Networking → Generate Domain*), then fill in the
variables, then deploy.

## 4. First deploy

Push, or `railway up`. On the `api` service, each release runs

```
bunx --bun prisma migrate deploy
```

(`--bun` matters: plain `bunx` honours the Prisma CLI's `#!/usr/bin/env node`
shebang and there is no Node in the image.)

No `cd` in front of it, deliberately. The image's `WORKDIR` is already
`/app/apps/api`, so the `cd /app/apps/api &&` this used to carry bought nothing
and cost the one thing that matters here: a command containing `&&` only runs if
Railway hands it to a shell, and a pre-deploy container that fails to *start*
reports "Pre-deploy command failed" with an empty log, which is the least
debuggable failure in the whole pipeline. This form is a plain argv and runs
either way.

as its **pre-deploy command**, so migrations are applied before the new version
takes traffic and a failed migration aborts the release rather than half-applying
it. pg-boss provisions its own `pgboss` schema on boot — that is a second
migration system beside Prisma's and it needs nothing from you.

The healthcheck is `GET /api/health`. Note that `startJobs()` runs *before*
`app.listen`, deliberately: a failure to start the queue takes the boot down
rather than serving an API that silently runs no background work. If the
healthcheck times out, read the deploy logs for a pg-boss error before suspecting
the app.

## 5. Create the first admin

Sign-up is disabled (`disableSignUp: true`), so seeding is the only way a first
user exists.

Set `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` as variables on the `api`
service — not on a command line, where the password lands in shell history — then
run the seed **inside the container**:

```bash
railway ssh --service api --command 'cd /app/apps/api && bun run db:seed'
```

`--service` takes the service's **actual name in your project**, which is only
`api` if you named it that; `railway status` lists them. Every `railway ssh`
line in this document uses the generic names from section 1.

Note the command: `railway run` executes **locally** with Railway's variables
injected, which is not what you want here (it would need Bun, the generated
Prisma client and a publicly reachable database on your own machine).
`railway ssh --command` runs in the deployed container. Delete the two seed
variables afterwards; nothing reads them again.

**Changing `SEED_ADMIN_PASSWORD` and re-running the seed does nothing.**
`upsertUser` sets a password only when it *creates* the account — an existing
one has its role reconciled and its credentials left alone, deliberately, so
that re-running the seed on a live database cannot reset a real person's
password. To change the admin password after the fact, use the app: sign in and
change it, or have another admin do it from the Users screen.

The seed **skips the demo `agent@example.com` / `password123` account when
`NODE_ENV=production`** — which the image sets — so this cannot quietly leave a
published-password account on a deployed database. Real agents are created by the
admin through the Users screen.

It does create the **assistant's account** (`assistant@automation.invalid`,
`user.automated = true`) in production as well, and that one is safe there
because there is no password to leave behind: it has no credential record at all,
so nothing can sign in as it, and both mutating user routes 403 on it. It exists
to be the assignee on tickets the knowledge base answered by itself. Without it
those tickets keep an empty Assignee cell, which is precisely how an untouched
ticket looks — `/pipeline` says so on the "Who ends up with it" card rather than
leaving you to work it out. The seed looks before it creates, so re-running it
never makes a second one.

Then seed the knowledge base, if you want the shipped corpus:

```bash
railway ssh --service api --command 'cd /app/apps/api && bun run db:seed:kb'
```

It skips ids that already exist, so it is safe to re-run. Without at least one
article flagged for auto-reply, the lower half of `/pipeline` is permanently
dead — which the page will tell you (`autoReplyArticleCount`).

## 6. Postmark

Point the inbound webhook at

```
https://<api-domain>/api/webhooks/inbound-email
```

with the Basic Auth credentials you set above. Outbound sending is Phase 3 and
does not exist yet — the auto-reply writes a `Message` row and sends nothing.

---

## Cookies: read this before the first login

Sessions are cookie-based, so the only question that matters is whether the
browser considers the app and the API to be the same **site**. Not the same
origin — the same site, which is decided by the registrable domain.

**The web service proxies `/api/*` to the API, so they are one origin and the
question does not arise.** That is what `API_UPSTREAM` and the empty
`VITE_API_URL` above are for. The cookie is first-party and `SameSite=Lax`, the
strongest of the three arrangements, and it needs no domain of your own.

The API works out that it is same-origin from `BETTER_AUTH_URL`: if that origin
is one of `TRUSTED_ORIGINS`, it is being reached on the app's own origin and the
`SameSite=None` fallback below is not applied. Getting it wrong is not a
lockout — `None` works first-party too, it is only weaker.

### Why not call the API directly

Because `up.railway.app` is on the Public Suffix List, which makes
`web-x.up.railway.app` and `api-x.up.railway.app` different **sites**. No cookie
may be scoped to their shared suffix, a `SameSite=Lax` cookie is never sent on
the app's XHR, and the workaround — `COOKIE_DOMAIN` empty, so the cookie becomes
`SameSite=None; Secure` — makes the session a **third-party** cookie.

That is not merely the weaker setting. **Chrome incognito and Safari block
third-party cookies by default**, so sign-in answers `200`, the browser drops
the cookie, and the user stays signed out with nothing in the API log to show
for it. Measured on this deployment: allowing third-party cookies for the site
made it work immediately — which is not a thing to ask a support agent to do.
This is the arrangement the proxy exists to replace.

### If you own a domain

`app.example.com` + `api.example.com` are the same site. Set
`COOKIE_DOMAIN=.example.com`, put both origins in `TRUSTED_ORIGINS`, and the
cookie is issued for the shared parent — also `Lax`. Then the proxy is optional;
keep it or drop it on latency grounds, not cookie grounds.

`COOKIE_DOMAIN` is validated at boot against `TRUSTED_ORIGINS`: a value no
trusted origin sits under fails the boot instead of presenting as an
unexplainable logged-out loop. See the note in `apps/api/src/auth.ts`.

### The cost of the proxy

One extra hop inside Railway's network, and the web service is in the path of
every API call — if Caddy is down, the API is unreachable to the browser even
when it is healthy. Postmark is unaffected: the API keeps its own public domain
and the webhook still arrives there directly.

## The CSP is generated, not written

`apps/web/csp.ts` is the single definition of the page's Content-Security-Policy.
Three things consume it:

1. the build-time `<meta>` tag (minus `frame-ancestors`, which browsers ignore
   there);
2. `vite preview`, as a real header — the local rehearsal;
3. **production**: `vite build` emits `apps/web/csp.caddy`, and `Caddyfile`
   imports it inside its `header` block.

So the deployed app finally gets `frame-ancestors 'none'` as a real header, which
`CLAUDE.md` has been asking for. `csp.caddy` is generated and gitignored — edit
`csp.ts`, never it. Because `connect-src` is derived from `VITE_API_URL`, the
policy and the bundle are always produced together and cannot disagree.

## Things that are deliberately not here

- **Redis.** pg-boss runs in the Postgres already in the stack. Nothing needs it.
- **Rate-limit storage.** Better Auth's limiter is in memory, which is per
  instance. Fine at one replica; scaling `api` past one means either
  `rateLimit.storage: "database"` (needs a Prisma migration for its table) or
  accepting that the limit is per instance.
- **Multiple `api` replicas.** Beyond the rate limiter, the pg-boss workers are
  safe to run more than once — handlers are idempotent and `Processing` is a
  claim taken with a conditional `updateMany` — but nothing here has been
  measured at more than one.
- **Pinned base images.** Both Dockerfiles use `oven/bun:1-slim` and
  `caddy:2-alpine` — both confirmed to exist and be active on Docker Hub, both
  floating within a major. Pin to a digest for reproducible builds.

## Local rehearsal

Most of this can be checked without a Docker daemon, and was.

**Serve the real build the way production will.** Caddy is a single binary; you
do not need Docker to run the actual production config against the actual
`dist/`:

```bash
cd apps/web
bun run build                                          # also emits csp.caddy
caddy validate --config Caddyfile --adapter caddyfile
PORT=8899 API_UPSTREAM=localhost:3001 caddy run --config Caddyfile --adapter caddyfile
```

`VITE_API_URL` is left unset because that is what production uses now — the app
calls `/api/*` on its own origin. Run the API on :3001 beside it and the whole
thing works end to end, session cookie included.

Then check what comes back. `/` and every client route must carry
`Cache-Control: no-cache` and the full CSP including `frame-ancestors 'none'`;
`/assets/*` must be `immutable`; `/api/health` must reach the API rather than
returning the SPA shell. (On Windows, `curl` cannot reach local ports from the
bundled shell — use PowerShell's `Invoke-WebRequest -Method Head` instead.)

The Caddyfile is validated **at image build time** too (`caddy validate` in
`apps/web/Dockerfile`), so a syntax error there fails the build rather than the
first request after a deploy.

**Rehearse the API image's build steps** without a daemon by replaying what the
Dockerfile does, in an empty directory: copy the five `package.json` files and
`bun.lock`, run `bun install --frozen-lockfile` (this is the layer-caching step —
it proves the workspace graph resolves from manifests alone), then copy
`packages/` and `apps/api/` and run

```bash
DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" \
  bunx --bun prisma generate
```

**Check the cookie configuration took effect** — this is the setting most likely
to be wrong and least likely to announce it:

```bash
cd apps/api
DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" \
BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
NODE_ENV=production TRUSTED_ORIGINS="https://web-x.up.railway.app" COOKIE_DOMAIN="" \
BETTER_AUTH_URL="https://web-x.up.railway.app" \
bun -e 'const { auth } = await import("./src/auth.ts"); const c = await auth.$context; console.log(c.authCookies.sessionToken.name, JSON.stringify(c.authCookies.sessionToken.attributes))'
```

The first row is the one that matters: `BETTER_AUTH_URL` sitting inside
`TRUSTED_ORIGINS` is what the same-origin proxy looks like from the API's side.
Expected, and verified for all five cases:

| `NODE_ENV` | `COOKIE_DOMAIN` | `BETTER_AUTH_URL` | cookie name | `secure` | `sameSite` | `domain` |
|---|---|---|---|---|---|---|
| production | *(empty)* | a trusted origin | `__Secure-…` | `true` | `lax` | — |
| production | *(empty)* | the API's own | `__Secure-…` | `true` | `none` | — |
| production | `.example.com` | either | `__Secure-…` | `true` | `lax` | `.example.com` |
| *(dev)* | *(empty)* | either | plain | `false` | `lax` | — |
| test | *(empty)* | either | plain | `false` | `lax` | — |

Dev and test are deliberately untouched by any of this — the E2E suite depends on
them.

**With Docker**, build both images from the **repo root**:

```bash
docker build -f apps/api/Dockerfile -t ticket-api .
docker build -f apps/web/Dockerfile -t ticket-web .
```

That last step is the one thing here that has not been run.
