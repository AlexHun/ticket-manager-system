import { Router } from "express";
import type { Request, Response } from "express";
import { USER_ROLE, type TicketEvent } from "@ticket/shared";
import { subscribe } from "../events/hub";
import { requireAuth, sessionOf } from "../middleware/auth";

/**
 * The event stream: `GET /api/events`, one per browser tab.
 *
 * Server-Sent Events rather than a WebSocket, and the deciding reason is the line
 * below that reads `requireAuth`. A WebSocket upgrade is an `http.Server`
 * `'upgrade'` event, not an Express request — no middleware chain, no `res`,
 * nowhere to mount the app's authentication — so it would mean a second
 * implementation of `requireAuth`, in a repo that says "apply to every protected
 * route". Browsers do not apply CORS to a WS handshake either, so the origin
 * pinning `cors({ origin: trustedOrigins })` gives us for free would be
 * hand-rolled too. Two security controls re-implemented, to buy a traffic
 * direction this app does not use: every agent action is already a REST mutation
 * with a schema, a guard, a transaction and an audit row.
 *
 * **This router is mounted above `compression()`** — see the note at the mount in
 * `index.ts`. That is load-bearing, not tidiness.
 *
 * The client half is `apps/web/src/lib/realtime.tsx`. The pattern either side is
 * lifted from the dev-tools runner (`apps/web/dev/plugin.ts` and
 * `apps/web/src/dev/use-test-run.ts`), which had already paid the tuition on the
 * header set, the listener set and reliance on the browser's own reconnect.
 */

export const eventsRouter = Router();

/**
 * How often a comment frame goes out.
 *
 * Idle proxies close a silent connection at 30-60s. The browser sees a clean
 * close and reconnects, so it still "works" — but a reconnect a minute is a full
 * resync a minute, which is the one cost this design has, on a timer.
 *
 * A **comment** (`: ping`) rather than an event: it never reaches `onmessage`, so
 * it needs no client code and no seat in `TICKET_EVENT`. Nothing else in the
 * system has to know it exists.
 */
const HEARTBEAT_MS = 25_000;

/**
 * How long one connection may live before the client is made to reconnect.
 *
 * **This is a security number, not a plumbing number** — do not tune it up
 * because reconnects look wasteful.
 *
 * `requireAuth` runs once, at connect. After that the stream is a capability held
 * by a socket: signing out does not close it, deleting the user does not close
 * it, and the `role` captured below for the audience filter is frozen at whatever
 * it was. Every ordinary request re-checks, so revocation elsewhere is bounded at
 * 60s by Better Auth's `cookieCache`. Ending the stream on a timer is what gives
 * this the same bound — `EventSource` reconnects on its own, and the reconnect
 * re-runs `requireAuth` and re-reads the role.
 *
 * Rejected the alternative of re-validating on each heartbeat: a `getSession` per
 * connection every 25s is far more database traffic than one reconnect a quarter
 * hour, and `cookieCache` would serve a stale answer for up to 60s of it anyway.
 */
const STREAM_MAX_MS = 15 * 60_000;

/**
 * ±10%, because a deploy reconnects everybody at the same instant.
 *
 * Without it they stay synchronised for the life of the process and re-handshake
 * in a pulse every fifteen minutes.
 */
function streamLifetime(): number {
  return Math.round(STREAM_MAX_MS * (0.9 + Math.random() * 0.2));
}

/**
 * Drop a connection whose socket has stopped draining.
 *
 * A suspended laptop accumulates frames in the kernel buffer. Ending the response
 * costs that tab a reconnect and a resync; not ending it costs the process a leak
 * that grows for as long as the lid stays shut.
 */
const MAX_BUFFERED_BYTES = 64 * 1024;

eventsRouter.get("/", requireAuth, (req: Request, res: Response) => {
  // Frozen for the life of the connection, which is what `STREAM_MAX_MS` bounds.
  const role =
    sessionOf(res).user.role === USER_ROLE.admin
      ? USER_ROLE.admin
      : USER_ROLE.agent;

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    // `no-transform` is the second half of the compression fix, and it works
    // because `on-headers` applies these before compression's own check runs:
    // it sees the header and declines to touch the response. Mounting above
    // `compression()` should already have settled it; this survives a future
    // re-order of the middleware stack, which is the failure worth insuring
    // against because a gzipped event stream still *works* — events just arrive
    // in clumps, minutes late, and that reads as "SSE is flaky".
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // nginx-specific and inert everywhere else. Nothing in front of this today
    // buffers, but a stream is exactly the thing a future proxy breaks silently.
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  // Nagle would otherwise hold a small frame back waiting for company, which is
  // every frame this route sends.
  req.socket.setNoDelay(true);

  const send = (event: TicketEvent): void => {
    if (res.writableLength > MAX_BUFFERED_BYTES) {
      res.end();
      return;
    }
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  // Immediately, before anything is subscribed: it pushes the response head
  // through any intermediary that buffers until the first byte, so `onopen`
  // fires now rather than whenever the first real event happens to arrive —
  // which on a quiet desk could be an hour.
  res.write(": ping\n\n");

  const unsubscribe = subscribe({
    role,
    send,
    close: () => res.end(),
  });

  // Owned per connection rather than at module scope, deliberately. A
  // module-level `setInterval` accumulates one copy per `bun --hot` reload;
  // there is nothing to leak if the only timers live and die with a request.
  // `routes/ai.ts` refused a module-level sweep timer for the same reason.
  const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
  const lifetime = setTimeout(() => res.end(), streamLifetime());

  req.on("close", () => {
    clearInterval(heartbeat);
    clearTimeout(lifetime);
    unsubscribe();
  });
});
