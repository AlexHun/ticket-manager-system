# Tech Stack

## Stack

| Layer | Pick | Notes |
|---|---|---|
| Frontend | React + Vite + TypeScript | SPA; talks to backend via REST/JSON |
| Backend | Node.js + Express + TypeScript | REST API, inbound email webhook, AI orchestration, auth |
| UI | Tailwind + shadcn/ui | Fast to build dashboard / list / detail views |
| Database | Postgres (Neon or Supabase) | Standard relational; Neon branching is useful for schema work |
| ORM | Prisma or Drizzle | Drizzle for SQL-first/lighter; Prisma for richer ecosystem |
| Auth | `express-session` + `connect-pg-simple` + `bcrypt` | Postgres-backed **database session** store; opaque cookie resolved per request |
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

- Strategy: **database sessions** (not JWT).
- Middleware: `express-session` with `connect-pg-simple` as the store, writing to a `session` table in Postgres.
- Passwords: `bcrypt` (cost factor 12).
- Cookie: `HttpOnly`, `Secure`, `SameSite=Lax`, signed with a server secret. Holds only an opaque session ID.
- Every authenticated request → one DB read to resolve the session and load the user + role.
- Logout / revocation: delete the session row. Effect is immediate across all devices.
- Role changes (admin promoting/demoting an agent) take effect on the next request — no token to wait out.

## CORS / cookies

- Frontend and backend will run on different origins, so the API must set `Access-Control-Allow-Credentials: true` and the frontend must send `credentials: "include"` on fetches.
- In production, prefer same parent domain (`app.example.com` + `api.example.com`) so the session cookie can be scoped to `.example.com`.

## Deliberately skipped (add only if needed)

- Vector DB / embeddings — knowledge base fits in Claude's context window with prompt caching.
- JWT / refresh tokens — database sessions are simpler and meet the requirements.
- Redis / queue — revisit when inbound volume or AI latency forces async processing.
- GraphQL — REST is enough for this surface area.
