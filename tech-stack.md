# Tech Stack

## Stack

| Layer | Pick | Notes |
|---|---|---|
| Frontend | React + Vite + TypeScript | SPA; talks to backend via REST/JSON |
| Backend | Node.js + Express + TypeScript | REST API, inbound email webhook, AI orchestration, auth |
| UI | Tailwind + shadcn/ui | Fast to build dashboard / list / detail views |
| Database | Postgres (Neon or Supabase) | Standard relational; Neon branching is useful for schema work |
| ORM | Prisma or Drizzle | Drizzle for SQL-first/lighter; Prisma for richer ecosystem |
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
- Email/password is the only enabled provider for now. Role-based access (`role`, `active`) and email verification land later as additional fields / plugin config — see `implementation-plan.md` Phase 1.

## CORS / cookies

- Frontend and backend will run on different origins, so the API must set `Access-Control-Allow-Credentials: true` and the frontend must send `credentials: "include"` on fetches.
- In production, prefer same parent domain (`app.example.com` + `api.example.com`) so the session cookie can be scoped to `.example.com`.

## Deliberately skipped (add only if needed)

- Vector DB / embeddings — knowledge base fits in the context window with prompt caching. Still true, and now measured rather than assumed: the shipped corpus is ~6KB, sent whole in the system prompt so the prefix caches. Revisit when it stops fitting, not before.
- ~~`knowledge_articles` table + admin CRUD UI~~ — **the knowledge base is a file**, `apps/api/knowledge-base.md`, parsed at boot by `ai/knowledge-base.ts`. Phase 5 assumed a table with an admin screen; a file won because of what the content became. An article marked `Auto-reply: yes` is put in front of newly arrived tickets with no human in the loop, so editing one changes what the support desk tells customers unattended. That makes editing a *privileged* action, and a file gets code review, blame and a diff for free where a CRUD form gets none of them. A table is still the right end state for a support team that edits its own answers — it just has to arrive with an audit log and an approval step, which is a bigger piece of work than the form.
- JWT / refresh tokens — database sessions are simpler and meet the requirements.
- ~~Redis / queue~~ — **the revisit happened.** "Add a queue only when timeouts or retries demand it" was the original bar, and retries cleared it: automatic ticket classification runs off the inbound-email webhook, three of its six failure modes are transient, and the in-memory queue it started on could act on none of them — a ticket that arrived during a provider blip stayed uncategorised forever, and a deploy dropped the queue silently. **pg-boss** was adopted rather than Inngest or BullMQ because the constraint this list was really expressing is "no new infrastructure": pg-boss runs in the Postgres already in the stack, in its own `pgboss` schema, so it costs a dependency instead of a service. **Redis itself is still deferred** and nothing here needs it. See `apps/api/src/jobs/`; Phase 3's outbound Postmark send is the next thing that belongs on it.
- GraphQL — REST is enough for this surface area.
