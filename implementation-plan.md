# Implementation Plan

Phased build for the AI-Powered Ticket Management System. Each phase is independently shippable.

## Ordering principles

1. **Each phase ships something usable** — stop after any phase and you still have a working subset.
2. **Boring before risky** — foundations and CRUD stabilize before AI uncertainty enters.
3. **Dependencies flow forward** — auth gates UI; ticket model feeds email; email feeds AI.
4. **Read-only AI before write AI** — classify/summarize first; suggested replies before auto-send.
5. **Reversibility** — high-impact, hard-to-change pieces (schema, auth) early; tunable pieces (rules, dashboard) late.

---

## Phase 0 — Foundations

- Initialize monorepo (pnpm workspaces): `apps/web`, `apps/api`, `packages/shared`
- Scaffold `apps/api` (Express + TS + tsx for dev reload)
- Scaffold `apps/web` (Vite + React + TS)
- Shared types package wired into both apps
- ESLint + Prettier + tsconfig base
- `docker-compose.yml` for local Postgres
- Pick ORM (Prisma or Drizzle) and run first migration
- `GET /api/health` endpoint
- `.env.example` + config loader
- Minimal CI: typecheck + lint

## Phase 1 — Auth & user management

- `users` table (id, email, password_hash, role, active, timestamps)
- `session` table (per `connect-pg-simple`)
- Seed script for the bootstrap admin
- `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`
- `requireAuth` + `requireRole('admin')` middleware
- CORS config with `credentials: true`
- React: login page, auth context, protected route wrapper
- Admin: list users, create agent, deactivate agent

## Phase 2 — Tickets (manual, no email/AI yet)

- `tickets` table (id, subject, status, category, customer_email, customer_name, timestamps)
- `messages` table (id, ticket_id, direction, body, author_user_id, timestamps, `email_message_id`, `in_reply_to`)
- `POST /tickets` (manual create for testing)
- `GET /tickets` with filter (status, category) + sort
- `GET /tickets/:id` with messages
- `PATCH /tickets/:id` for status/category
- `POST /tickets/:id/messages` for agent replies
- React: tickets list page, detail page, reply composer

## Phase 3 — Email ingestion + outbound

- Postmark account + inbound stream configured
- `POST /webhooks/postmark` — **Postmark does not sign inbound webhooks.** There is no HMAC to verify; their documented recommendation is HTTP Basic Auth credentials in the webhook URL plus allowlisting their published IP ranges. The Basic Auth is built (`routes/webhooks/inbound-email.ts`); the IP allowlist belongs in `apps/web/Caddyfile`. This line used to say "with signature verification", which described something the provider does not offer.
- Thread inbound by `In-Reply-To` / `References`; otherwise create new ticket
- Outbound send via Postmark on agent reply — goes through the outbox (`docs/adr/0009`), so this is binding `mail/transport.ts`, not touching callers
- Set outbound `Message-ID` + `References` so customer replies thread back
- Local dev via ngrok

## Phase 4 — AI: classification + summaries

- Anthropic SDK + `ANTHROPIC_API_KEY` wired
- Classify on ticket creation → `{General, Technical, Refund, Other}` + confidence
- Summarize on demand for long threads
- Store classification + confidence on the ticket
- Agent can override category; capture override for later tuning

## Phase 5 — Knowledge base + suggested replies

- `knowledge_articles` table (id, title, body, category, updated_at)
- Admin CRUD UI for KB
- Draft-reply prompt: takes ticket + KB, returns `{draft, confidence, citedArticleIds}`
- Use Claude **prompt caching** for the KB block
- "Suggested reply" panel: send-as-is, edit-then-send, or discard
- Persist the diff between draft and sent reply for later analysis

## Phase 6 — Automation: auto-send + routing

> Assumes "auto-generate responses" = auto-send when confident. Confirm before building.

- Per-category config: auto-send on/off, confidence threshold
- Auto-send pipeline on inbound: classify → draft → send if eligible → log
- Routing: assign agent by category (or round-robin) when not auto-sent
- In-app notification on assignment

## Phase 7 — Dashboard, metrics, polish

- Dashboard: open count, by category, by status, time-to-first-response
- AI metrics: auto-send rate, agent override rate, avg agent edit distance
- Ticket activity log (audit trail)
- Empty / loading / error states across the app
- Deploy: API → Railway/Render, web → Vercel, DB → Neon

---

## Open decisions to pin down before Phase 4

1. **Auto-send vs. suggested-only** — does Phase 6 exist, or is "auto-generate" actually "draft for agent"?
2. **KB shape** — structured (title/body/tags/category) vs. markdown blobs. Plan assumes structured.
3. **"Other" category** — added as fallback; original scope had only three categories.
