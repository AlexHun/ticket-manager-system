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
| AI | Anthropic SDK (Claude) | Classification, summaries, draft replies. Use prompt caching for the knowledge base |
| Inbound email | Postmark Inbound | Webhook delivers parsed JSON with `MessageID` / `In-Reply-To` for threading |
| Outbound email | Postmark (or Resend) | Prefer one vendor for inbound + outbound |
| Background jobs | None to start; Inngest or BullMQ if needed | Process AI inline in the webhook; add a queue only when timeouts or retries demand it |
| Frontend hosting | Vercel / Netlify / Cloudflare Pages | Any static host works |
| Backend hosting | Railway / Render / Fly.io | Long-lived Node process; needs to receive Postmark webhooks |

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

- Vector DB / embeddings — knowledge base fits in Claude's context window with prompt caching.
- JWT / refresh tokens — database sessions are simpler and meet the requirements.
- Redis / queue — revisit when inbound volume or AI latency forces async processing.
- GraphQL — REST is enough for this surface area.
