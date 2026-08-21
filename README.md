# Support Desk

An AI-powered ticket management system. It receives customer email, files it,
answers what it can from written knowledge, and hands the rest to people.

A support address forwards to an inbound webhook. Each arriving email becomes a
**ticket** (or a **message** on an existing one), gets **classified** into a
category, and — where a knowledge article covers it — gets an **auto-reply**
written and sent with nobody reading it first. Everything else lands in the
backlog for an **agent**, who gets AI summaries and reply polishing to work with.

- **Vocabulary** — [`CONTEXT.md`](./CONTEXT.md) fixes what every term above means.
- **Decisions** — [`docs/adr/`](./docs/adr/) records why the design is what it is.
- **Standards** — [`docs/standards/`](./docs/standards/) is how code here is written.

---

## What it does

**The unattended path.** Ingest → classify → auto-reply or hand off. Runs on
[pg-boss](https://github.com/timgit/pg-boss) jobs inside the application
database, so a provider blip retries instead of dropping a ticket on the floor.
Refund tickets are never answered automatically. Admins can watch a ticket
travel the whole pipeline at `/pipeline`, and inject a simulated one through the
real ingestion path.

**Assisted work.** Ticket list with filters and sorting, ticket detail with the
full thread, thread summaries, draft polishing, assignment, and a dashboard.

**Knowledge base.** Articles with full revision history and internal notes.
Marking one `auto-reply` puts it in front of newly arrived tickets, so editing
is admin-only and audited.

**Outbound mail.** Every email goes through a transactional outbox before it
goes anywhere else. With no mail provider configured the desk still works —
messages record as *undeliverable* and admins read them at `/outbox`, which is
how an invitation reaches a colleague on a deployment with no mail.

**Accounts.** Email/password sessions via Better Auth. Two roles: **admin**
(manages accounts, knowledge and automation) and **agent** (works tickets).
Sign-up is closed — the first admin is seeded, everyone else is invited.

Ticket statuses are `New → Processing → Open → Resolved → Closed`; categories
are `General`, `Technical`, `Refund`, `Other`.

---

## Stack

| Layer | Pick |
|---|---|
| Runtime | Bun 1.3.13 |
| Frontend | React 19 + Vite + TypeScript, Tailwind v4, shadcn/ui, TanStack Query/Table |
| Backend | Express 5 + TypeScript, server-sent events for live updates |
| Database | Postgres + Prisma 7 |
| Auth | Better Auth — database sessions, opaque cookie |
| AI | OpenAI `gpt-5-nano` via the Vercel AI SDK |
| Jobs | pg-boss, in its own `pgboss` schema in the same Postgres |
| Email | Postmark inbound webhook + outbound (both optional) |
| Errors | Sentry (optional) |
| Hosting | Railway — `api`, `web` and `postgres` in one project |

See [`tech-stack.md`](./tech-stack.md) for the rationale, including what was
deliberately skipped.

## Layout

```
apps/
  api/     Express API, ingestion, AI, jobs, outbox, Prisma schema + seeds
  web/     React SPA (Caddy serves the build and proxies /api in production)
packages/
  core/    Zod schemas shared by both sides
  shared/  Shared types and API contracts
tests/e2e/ Playwright suite
docs/      ADRs, coding standards, agent configuration
```

---

## Getting started

**Prerequisites:** [Bun](https://bun.sh) 1.3.13+ and a Postgres you can reach.
Neither an OpenAI key nor a mail provider is required — without them the AI
features answer 503, tickets stay uncategorised, and mail records as
undeliverable. Everything else runs.

```bash
git clone https://github.com/AlexHun/ticket-manager-system.git
cd ticket-manager-system
bun install
```

**Configure.** Copy both examples and read them — each variable is documented
where it lives:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

At minimum set `DATABASE_URL`, a 32+ character `BETTER_AUTH_SECRET`
(`openssl rand -base64 32`), and `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.
`apps/web/.env` is fine left empty in development — Vite proxies `/api` to the
API.

**Create the database.**

```bash
cd apps/api
bun run db:migrate        # apply migrations
bun run db:seed           # admin (+ a dev agent account outside production)
bun run db:seed:kb        # knowledge articles — the auto-reply is inert without them
bun run db:seed:tickets   # optional: 140 fake customers and their threads
cd ../..
```

**Run it.**

```bash
bun run dev               # API on :3001, web on :4000
```

Sign in at http://localhost:4000 with the seeded admin. Outside production the
seed also creates `agent@example.com` / `password123` for role testing.

Run one half at a time with `bun run dev:api` / `bun run dev:web`, and stop
stragglers with `bun run dev:stop`.

---

## Scripts

Root scripts run from the repo root; anything database-shaped must run from
`apps/api` — [`SCRIPTS.md`](./SCRIPTS.md) explains why, and is the full index of
every command with what it writes and where it may be run.

| Command | Does |
|---|---|
| `bun run dev` | both apps in watch mode |
| `bun run build` | build every workspace |
| `bun run typecheck` | typecheck every workspace |
| `bun run --filter '@ticket/api' test` | API unit tests (`bun test`) |
| `bun run --filter '@ticket/web' test` | web unit tests (Vitest + Testing Library) |
| `bun run test:e2e` | Playwright end-to-end suite |
| `bun run test:e2e:ui` | Playwright in UI mode |

**End-to-end tests** run against their own database (`ticket_manager_test`) on
their own ports (API `:3002`, web `:4001`), so a suite can run while
`bun run dev` is up. Prepare it once:

```bash
cp apps/api/.env.test.example apps/api/.env.test   # then edit DATABASE_URL
bun run db:test:migrate
bun run db:test:seed
```

CI ([`.github/workflows/ci.yml`](./.github/workflows/ci.yml)) runs typecheck,
unit tests, the web build and the E2E suite on every pull request. It does not
deploy.

---

## Deployment

Three Railway services from this one repo — `postgres`, `api` and `web` — with
`web` proxying `/api/*` to `api` over the private network so the browser only
ever talks to one origin. That is a cookie decision, and getting it wrong
presents as "login succeeds, user stays signed out".

[`DEPLOYMENT.md`](./DEPLOYMENT.md) is the procedure: service configuration,
Dockerfiles, migrations as a pre-deploy command, the CSP, and the cookie
arrangements in full. Read the cookie section before the first login.

---

## Working in this repo

[`CLAUDE.md`](./CLAUDE.md) points AI agents at the coding standards; humans
should read [`docs/standards/`](./docs/standards/) directly. Nearly every rule
there was measured, and several record a case where the obvious approach lost.
