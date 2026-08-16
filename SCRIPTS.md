# Scripts and seeds

Every command this repo can run, what it writes, and whether it belongs on a dev
machine or on a deployment.

`DEPLOYMENT.md` is the deployment *procedure*; this file is the index of the
commands it calls. Where the two overlap, `DEPLOYMENT.md` wins on Railway
specifics and this file wins on "what does this script actually do".

---

## The three environments

|              | database               | API   | web   | env file                            |
| ------------ | ---------------------- | ----- | ----- | ----------------------------------- |
| **dev**      | `ticket_manager`       | :3001 | :4000 | `apps/api/.env`, `apps/web/.env`    |
| **test/E2E** | `ticket_manager_test`  | :3002 | :4001 | `apps/api/.env.test`                |
| **prod**     | Railway `postgres`     | service URL | service URL | Railway service variables |

Dev and test are fully separate — different database, different ports, different
`BETTER_AUTH_SECRET` — so an E2E run can happen while `bun run dev` is up.

## Which directory to run from

Root scripts run from the repo root. Everything else lives in a workspace, so
`cd apps/api` (or `apps/web`) first.

```bash
cd apps/api && bun run db:seed          # do this
bun run --filter '@ticket/api' db:seed  # not for anything DB-shaped
```

`bun run --filter '<pkg>' <script>` *does* execute with the workspace as its cwd
on the Bun in use here (1.3.13 — verified, `bun test src` resolves inside
`apps/api`). It has not always: an older Bun ran the inner script from the
caller's cwd, which made `dotenv -e .env.test` silently find no file and pointed
a test reset at the **dev** database, wiping it. So the root `db:test:*` scripts
use an explicit `cd`, and so should you for anything that opens a connection.
`--filter` is fine for `typecheck` and `test`.

Argument order is `bun run --filter <pkg> <script>` — `bun --filter <pkg> run
<script>` fails with "No packages matched the filter".

---

## What may be run against production

| command                    | prod?               | why                                                              |
| -------------------------- | ------------------- | ---------------------------------------------------------------- |
| `prisma migrate deploy`    | **automatic**       | the API's Railway pre-deploy command; you never type it           |
| `db:seed`                  | **yes, once**       | sign-up is disabled, so this is the only way a first admin exists |
| `db:seed:kb`               | **yes, once**       | without it the auto-reply half of the app is inert                |
| `db:seed:tickets`          | **never**           | 140 fake customers and their email threads                        |
| `db:migrate`               | **never**           | that is `migrate dev`; it diffs, prompts and can reset            |
| `db:test:*`                | **never**           | reads `.env.test`, and `db:test:reset` wipes                      |

Both production seeds run **inside the container**, not locally:

```bash
railway ssh --service api --command 'cd /app/apps/api && bun run db:seed'
railway ssh --service api --command 'cd /app/apps/api && bun run db:seed:kb'
```

`railway run` would execute on *your* machine with Railway's variables injected —
wrong shell, wrong Prisma client, and it needs the database publicly reachable.

---

## The seeds

All three live in `apps/api/prisma/` and are run from `apps/api`. All three are
idempotent: re-running never duplicates a row, and none of them deletes anything
unless you pass `--reset`.

| script              | file                      | writes                                     | where          |
| ------------------- | ------------------------- | ------------------------------------------ | -------------- |
| `db:seed`           | `seed.ts`                 | admin, AI assistant, demo agent            | dev, test, prod |
| `db:seed:kb`        | `seed-knowledge-base.ts`  | `knowledge_article` rows                   | dev, prod      |
| `db:seed:tickets`   | `seed-tickets.ts`         | 140 demo tickets + their email threads     | dev only       |

### 1. `db:seed` — the accounts

```bash
cd apps/api && bun run db:seed
```

Needs `DATABASE_URL`, `BETTER_AUTH_SECRET`, `SEED_ADMIN_EMAIL`,
`SEED_ADMIN_PASSWORD`. It goes through Better Auth's own context to hash the
password, so a user it creates can sign in immediately.

It writes three rows:

- **The admin**, from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`, with a
  `credential` account row carrying the hash. If the email already exists it only
  corrects the role — the password is never rewritten.
- **The AI assistant** — `assistant@automation.invalid`, name `AI Assistant`,
  role `agent`, `automated: true`, and deliberately **no account row**, so there
  is no password and nothing can sign in as it. It exists to be the assignee on
  tickets the knowledge base answered by itself. This is the only writer of
  `user.automated` anywhere, and it looks before it creates — run the seed ten
  times and there is still exactly one.
- **The demo agent**, `agent@example.com` / `password123` — **skipped when
  `NODE_ENV=production`**, which the API's Dockerfile sets. That is what makes
  seeding a deployed database safe: it cannot leave a published-password account
  behind. Real agents are created by an admin through the Users screen.

Dev and test logins, both seeded by this script:

| email               | password      | role  |
| ------------------- | ------------- | ----- |
| `admin@example.com` | `password123` | admin |
| `agent@example.com` | `password123` | agent |

On production, delete `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` from the
service afterwards — nothing reads them again.

### 2. `db:seed:kb` — the knowledge base

```bash
cd apps/api && bun run db:seed:kb
```

Parses `apps/api/knowledge-base.md` into the `knowledge_article` table. An
article whose id is already there is skipped **whole, flag included**, so this
can never undo an admin's decision to withhold something from the auto-reply.

`knowledge-base.md` is a seed corpus for a fresh deployment and is **not read at
runtime** — the live corpus is the table, edited at `/knowledge` with an audit
trail. Without at least one article flagged for auto-reply, the lower half of
`/pipeline` is permanently dead; the page says so (`autoReplyArticleCount`)
rather than looking like a quiet week.

### 3. `db:seed:tickets` — demo tickets (dev only)

```bash
cd apps/api && bun run db:seed:tickets            # append what's missing
cd apps/api && bun run db:seed:tickets --reset    # delete the demo rows first
```

140 tickets across all four categories and every status except `Processing`,
each with a 2–5 message email thread, dates spread over ~6 months. Requires
`db:seed` to have run first — it assigns tickets to real users and throws
`No users found` otherwise.

Rows are matched on subject + customer email, so both modes leave anything that
arrived through the webhook (or the `/pipeline` simulator) alone. The plain run
also backfills threads onto demo tickets seeded before threads existed.

Kept out of `db:seed` on purpose: that one also runs against the **test**
database, where 140 extra rows would undermine the E2E fixtures.

---

## First run on a fresh machine

```bash
bun install

cp apps/api/.env.example apps/api/.env
cp apps/api/.env.test.example apps/api/.env.test
cp apps/web/.env.example apps/web/.env
# then put a real secret in both API env files:
openssl rand -base64 32

# both databases, on your local Postgres
psql -U postgres -c 'CREATE DATABASE ticket_manager'
psql -U postgres -c 'CREATE DATABASE ticket_manager_test'

cd apps/api
bun run db:generate        # required — see below
bun run db:migrate
bun run db:seed
bun run db:seed:kb
bun run db:seed:tickets
cd ../..

bun run db:test:migrate    # from the root; test DB schema
bun run db:test:seed       # from the root; test DB users

bun run dev                # API :3001, web :4000
```

Then sign in at http://localhost:4000 as `admin@example.com` / `password123`.

**`db:generate` is not optional and nothing runs it for you.** The Prisma client
is generated into `apps/api/src/generated/prisma`, which is gitignored, and there
is no `postinstall` hook — a fresh clone will not start until you run it. Re-run
it after any change to `schema.prisma`.

## First run on a deployment

Covered in full by `DEPLOYMENT.md` §4–5. In command terms it is only this:

1. Push. Railway builds both images and the API's **pre-deploy command** runs
   `bunx --bun prisma migrate deploy` before the new version takes traffic.
   Nothing else runs by itself — pg-boss provisions its own `pgboss` schema on
   boot and needs nothing from you.
2. `railway ssh … 'cd /app/apps/api && bun run db:seed'`
3. `railway ssh … 'cd /app/apps/api && bun run db:seed:kb'`
4. Delete the two `SEED_ADMIN_*` variables.

Every deploy after the first is step 1 alone.

---

## Full script reference

### Root — run from the repo root

| script                | what it does                                                       |
| --------------------- | ------------------------------------------------------------------ |
| `bun run dev`         | API (:3001) and web (:4000) together                                |
| `bun run dev:api`     | API only                                                            |
| `bun run dev:web`     | web only                                                            |
| `bun run dev:stop`    | kills every dev server on 3001/3002/4000/4001 and proves the ports came back. **Windows/PowerShell only** — it has to outlive the `bun` that launched it |
| `bun run build`       | builds every workspace that has a `build` script (the web app; the API ships as source) |
| `bun run typecheck`   | `tsc --noEmit` across all four workspaces                           |
| `bun run test:e2e`    | Playwright; starts its own API and web on :3002/:4001 from `.env.test` |
| `bun run test:e2e:ui` | the same, in Playwright's UI mode                                   |
| `bun run test:e2e:report` | opens the last HTML report                                      |
| `bun run db:test:migrate` | `migrate deploy` against the **test** database                  |
| `bun run db:test:seed`    | `db:seed` against the **test** database                         |
| `bun run db:test:reset`   | **wipes** the test database, re-migrates, re-seeds               |

### `apps/api` — `cd apps/api` first

| script                     | what it does                                                  |
| -------------------------- | ------------------------------------------------------------- |
| `bun run dev`              | `bun --hot src/index.ts` on :3001                              |
| `bun run start`            | same without `--hot`; this is what the container runs          |
| `bun run typecheck`        | `tsc --noEmit`                                                 |
| `bun run test`             | `bun test src` — unit tests. Provider, database and session are mocked, so no `OPENAI_API_KEY` and no database needed |
| `bun run db:generate`      | regenerates the Prisma client into `src/generated/prisma`      |
| `bun run db:migrate`       | `prisma migrate dev` — **dev only**, it diffs and can reset    |
| `bun run db:deploy`        | `prisma migrate deploy` — applies pending migrations, nothing else. This is what production runs |
| `bun run db:studio`        | Prisma Studio against whatever `.env` points at                |
| `bun run db:seed`          | accounts — see above                                           |
| `bun run db:seed:tickets`  | demo tickets — see above, dev only                             |
| `bun run db:seed:kb`       | knowledge base — see above                                     |
| `bun run db:test:migrate`  | `dotenv -e .env.test -- prisma migrate deploy`                 |
| `bun run db:test:seed`     | `bun --env-file=.env.test prisma/seed.ts`                      |
| `bun run db:test:reset`    | reset + reseed the test database                               |

### `apps/web` — `cd apps/web` first

| script                | what it does                                             |
| --------------------- | -------------------------------------------------------- |
| `bun run dev`         | `bunx --bun vite` on :4000, proxying `/api` to :3001      |
| `bun run build`       | `tsc -b && vite build`; also emits `csp.caddy`            |
| `bun run preview`     | serves `dist/` with the CSP header                        |
| `bun run typecheck`   | `tsc -b --noEmit`                                         |
| `bun run test`        | Vitest once (CI form)                                     |
| `bun run test:watch`  | Vitest watch mode                                         |
| `bun run test:ui`     | the Vitest dashboard — best for authoring                 |

---

## Traps worth knowing before you hit them

- **Nothing generates the Prisma client for you.** No `postinstall`. A fresh
  clone, or a pulled `schema.prisma` change, needs `bun run db:generate`.
- **`db:migrate` ≠ `db:deploy`.** `migrate dev` authors and can reset; only
  `migrate deploy` may point at a deployment, and it already does, as the
  pre-deploy command.
- **Prisma 7 under an AI agent.** `migrate reset` refuses to run unless
  `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=1` is set, and
  `migrate dev --create-only` **hangs forever printing nothing** — it is waiting
  on a prompt that never renders. Author migrations non-interactively instead:
  `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`,
  write the folder by hand, apply with `migrate deploy`.
- **`bun --env-file` does not reach a child `bun`.** The inner process re-loads
  the default `.env`, and `--env-file` ignores `NODE_ENV` entirely. That is why
  the test scripts use `dotenv-cli` and why Playwright's `webServer` spawns
  `bunx dotenv -e .env.test -- bun src/index.ts`.
- **A `db:test:*` command that logs the wrong database name is the `--filter`
  trap**, not a typo. Stop and check the cwd before running it again.
- **`bun run --filter` exit code 255 means the task was killed**, not that it
  crashed — read the last log line before debugging.
- **E2E reuses a running server outside CI.** If sign-in fails with
  "Invalid origin", a stale vite is holding :4001; `bun run dev:stop` first.
