# Tech Stack

## Stack

| Layer | Pick | Notes |
|---|---|---|
| Frontend | React + Vite + TypeScript | SPA; talks to backend via REST/JSON |
| Backend | Node.js + Express + TypeScript | REST API, inbound email webhook, AI orchestration, auth |
| UI | Tailwind + shadcn/ui | Fast to build dashboard / list / detail views |
| Database | **Postgres — Railway (adopted)** | A `postgres` service in the same Railway project as the API, injected as `${{Postgres.DATABASE_URL}}`. Neon or Supabase would still serve: nothing here uses a Railway-specific database feature, only the private network in front of it. Note that the job queue lives in this same database — see pg-boss below. |
| ORM | **Prisma 7 (adopted)** | Via the `@prisma/adapter-pg` driver adapter, client generated into `apps/api/src/generated/prisma`. The SQL-first case Drizzle would have answered is handled where it actually arises: the dashboard aggregates compose raw statements with `Prisma.sql`. |
| Auth | [Better Auth](https://better-auth.com) | Postgres-backed **database session** store; opaque cookie resolved per request. Replaces hand-rolled `express-session` + `connect-pg-simple` + `bcrypt`. |
| AI | **OpenAI `gpt-5-nano`** via the Vercel AI SDK | Polishing, summaries, classification and knowledge-base auto-reply. Prompt caching is used for the KB block, as planned — just on this provider. See `CLAUDE.md` |
| Inbound email | Postmark Inbound | Webhook delivers parsed JSON with `MessageID` / `In-Reply-To` for threading |
| Outbound email | Postmark (or Resend) | Prefer one vendor for inbound + outbound |
| Background jobs | **pg-boss** (adopted) | Postgres-backed, so no new service. Chosen over Inngest/BullMQ because it needs no Redis and no vendor — see below |
| Frontend hosting | **Railway (adopted)** | Static `dist/` served by Caddy. Any static host still works, but a host in the same project as the API is what lets the CSP, the cookie domain and the API origin be configured once — see `DEPLOYMENT.md` |
| Backend hosting | **Railway (adopted)** | Long-lived Bun process; receives Postmark webhooks and runs the pg-boss workers. Postgres is a service in the same project |

## Project layout

A monorepo with two apps keeps types shared:

```
/apps
  /web        React + Vite frontend
  /api        Express + TypeScript backend
/packages
  /shared     Shared types (Ticket, User, API contracts)
```

## Authentication detail

- Strategy: **database sessions** (not JWT). Implemented with [Better Auth](https://better-auth.com) using its Prisma adapter against our Postgres.
- Better Auth owns the `User`, `Session`, `Account`, and `Verification` tables. Routes are mounted at `/api/auth/*` via `toNodeHandler(auth)` (Express 5 named-wildcard `/api/auth/*splat`).
- Passwords: hashed by Better Auth (scrypt) — stored in the `Account` table, not on `User`.
- Cookie: `HttpOnly`, `SameSite=Lax`, signed with `BETTER_AUTH_SECRET`. `Secure` flag set automatically in production. Holds only an opaque session token.
- Every authenticated request → one DB read to resolve the session and load the user.
- Logout / revocation: delete the `Session` row (or call `auth.api.signOut` / `revokeSession`). Effect is immediate across all devices.
- Email/password is the only enabled provider, and sign-up is closed — an admin creates every account.
- **Role-based access shipped.** Better Auth's `admin` plugin (`defaultRole: agent`, `adminRoles: [admin]`) plus a `Role` enum on `User`. `requireAuth` / `requireAdmin` in `apps/api/src/middleware/auth.ts` are the control; the SPA's `ProtectedRoute` / `AdminRoute` are UX and enforce nothing.
- **There is no `active` column.** Deactivation is a soft delete: `deletedAt` is stamped, `banned` is set, and the account's sessions are deleted in the same transaction, so revocation is immediate. Roster and assignee queries filter on `deletedAt: null`. The row stays because tickets and revisions reference it.
- **Email verification deliberately did not ship.** `emailVerified` is forced true at creation and never read to decide anything — the admin who typed the address already knows the colleague. See `docs/adr/0010-no-email-verification.md`.

## CORS / cookies

- Frontend and backend will run on different origins, so the API must set `Access-Control-Allow-Credentials: true` and the frontend must send `credentials: "include"` on fetches.
- In production, prefer same parent domain (`app.example.com` + `api.example.com`) so the session cookie can be scoped to `.example.com`.

## Deliberately skipped (add only if needed)

- Vector DB / embeddings — knowledge base fits in the context window with prompt caching. Still true, and now measured rather than assumed: the shipped corpus is ~6KB, sent whole in the system prompt so the prefix caches. Revisit when it stops fitting, not before.
- ~~`knowledge_articles` table + admin CRUD UI~~ — **the revisit happened, and this time the table won.** The corpus was a checked-in file, `apps/api/knowledge-base.md`, parsed at boot by `ai/knowledge-base.ts`. It argued for itself on real grounds: an article marked `Auto-reply: yes` is put in front of newly arrived tickets with no human in the loop, so editing one is a *privileged* action, and a file gets code review, blame and a diff for free where a CRUD form gets none of them. But it set exactly one condition for moving into a table — *"a table can come later; it should come with an audit log"* — and that is what was built. Every write to `KnowledgeArticle` records a full `KnowledgeArticleRevision` in the same transaction, with the editor's name denormalised onto it so the trail outlives the account being deleted; articles archive rather than delete, because replies already sitting in customers' threads cite them by id and the database refuses the delete. The screen is `/knowledge`, with `requireAdmin` on every route in `apps/api/src/routes/knowledge.ts`. Two guarantees the file enforced on text, the table enforces structurally: internal notes are a column `CORPUS_SELECT` does not name rather than a `> Internal:` regex stripped on the way past, and withheld articles are filtered in the `where` rather than discouraged in the prompt. There is **no cache** — the corpus is read per answered ticket, because an edit that appears to save and changes nothing until the next restart is the worst possible failure this screen has, and the cost is one indexed query over a few dozen small rows on a path about to spend seconds in a model call. The approval step is the half that did not ship; admin-only access plus the per-article `autoReply` flag are what stand in for it. The markdown file survives as the **seed corpus** for a fresh deployment (`prisma/seed-knowledge-base.ts`, parser in `src/knowledge-base-import.ts`) and is not read at runtime. See `docs/adr/0006-knowledge-articles-are-rows-with-revisions.md`.
- JWT / refresh tokens — database sessions are simpler and meet the requirements.
- ~~Redis / queue~~ — **the revisit happened.** "Add a queue only when timeouts or retries demand it" was the original bar, and retries cleared it: automatic ticket classification runs off the inbound-email webhook, three of its six failure modes are transient, and the in-memory queue it started on could act on none of them — a ticket that arrived during a provider blip stayed uncategorised forever, and a deploy dropped the queue silently. **pg-boss** was adopted rather than Inngest or BullMQ because the constraint this list was really expressing is "no new infrastructure": pg-boss runs in the Postgres already in the stack, in its own `pgboss` schema, so it costs a dependency instead of a service. **Redis itself is still deferred** and nothing here needs it. See `apps/api/src/jobs/`; Phase 3's outbound Postmark send is the next thing that belongs on it.
- GraphQL — REST is enough for this surface area.
