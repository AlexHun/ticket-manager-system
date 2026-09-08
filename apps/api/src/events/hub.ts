import * as Sentry from "@sentry/bun";
import { EVENT_AUDIENCE, type TicketEvent, type UserRole } from "@ticket/shared";
import { inTransaction } from "../transaction-scope";

/**
 * The set of open event streams, and nothing else.
 *
 * Split from `ticket-events.ts` the way `jobs/boss.ts` is split from the handlers
 * beside it: this file knows how to hold a connection and how to decide who hears
 * a thing, and knows no publisher by name. Every publisher goes through
 * `publish`, which is the property that makes the multi-instance upgrade
 * mechanical — see the note on `publish`.
 *
 * That property turned out to be worth a second thing (ADR-0015). Because every
 * event goes through one function, one function can refuse an event published
 * from inside an open transaction — which is the half of the publish rule that
 * fails silently, and the half no reviewer reliably catches. See
 * `refuseInsideTransaction`.
 *
 * **A `Set`, not an `EventEmitter`.** Two concrete reasons, both cheap to hit.
 * `EventEmitter` prints `MaxListenersExceededWarning` past ten listeners, and ten
 * listeners here is ten open browser tabs — a normal Tuesday, reported as a leak.
 * And an emitted `'error'` with no listener **takes the process down**, which is
 * a hazard `jobs/boss.ts` already documents and works around for pg-boss. A `Set`
 * has neither problem and no API surface to misuse.
 */

/** One open stream. `close` is separate from `send` so shutdown can end it. */
export interface EventConnection {
  /** Captured at subscribe time, which is why connections are capped — see `routes/events.ts`. */
  role: UserRole;
  send: (event: TicketEvent) => void;
  close: () => void;
}

/**
 * Survives `bun --hot`, and that is not a nicety.
 *
 * `--hot` re-evaluates a changed module in the same process. Without this, a
 * publisher rebound to the fresh module fans out into a brand-new **empty** set
 * while every live connection still hangs off the old one — so the stream stays
 * open, the page stays subscribed, and nothing ever arrives again. The symptom is
 * "SSE stopped working after I edited a route": intermittent, unreproducible
 * after a restart, and exactly how a working design gets thrown out.
 *
 * Same fix and same shape as the Prisma client in `db.ts`, and the same reason
 * `routes/ai.ts` records that a reload clears its rate-limit map.
 */
const globalForEvents = globalThis as unknown as {
  eventConnections: Set<EventConnection> | undefined;
};

const connections: Set<EventConnection> =
  globalForEvents.eventConnections ?? new Set<EventConnection>();

if (process.env.NODE_ENV !== "production") {
  globalForEvents.eventConnections = connections;
}

/** Register a stream. Returns the unsubscribe, to be called from `req.on("close")`. */
export function subscribe(connection: EventConnection): () => void {
  connections.add(connection);
  return () => {
    connections.delete(connection);
  };
}

/**
 * Refuse an event published from inside an open transaction — or, in
 * production, report it and let it through.
 *
 * The enforced half of ADR-0015's rule: **publish after the commit that made the
 * fact true, never inside the transaction.** `events/ticket-events.ts` has owned
 * that rule in prose since it was written, and prose is enough for the half a
 * reviewer can see. This half fails silently — a subscriber refetches on an
 * event published mid-transaction, reads pre-commit state, caches it, and is
 * never told again because the event that would have corrected it has been
 * spent — so nothing but review stood between a seventh call site and a bug
 * nobody would report. The spike that compared the six existing sites (#153)
 * decided against a module they could share and for this, precisely because it
 * costs no call site anything: `db.ts` and `test/pg.ts` mark the inside of a
 * transaction, and the one function every event already goes through reads it.
 *
 * **Loud outside production, survivable inside it**, and the asymmetry is the
 * point rather than a hedge. In development, in the API suite and in E2E, a
 * throw is the fastest possible way to learn — it surfaces at the offending
 * call, in the failing test, with a stack. In production the same throw would be
 * a failed request, or a job that retries and re-answers a customer, in exchange
 * for preventing a screen that refreshes a moment late. That trade is not close.
 * So production logs, alerts once per event kind, and fans out anyway.
 *
 * The message is constant so every occurrence groups into one Sentry issue
 * rather than one per ticket — the same shape as the exhaustion alert in
 * `jobs/boss.ts`. Attaching the event is safe here in a way a payload usually is
 * not: a `TicketEvent` is a kind, an id and a timestamp, and carries no customer
 * text by construction (see its note in `@ticket/shared`).
 */
function refuseInsideTransaction(event: TicketEvent): void {
  if (!inTransaction()) return;

  const message =
    `[events] ${event.kind} for ticket ${event.ticketId} was published inside a ` +
    `transaction — publish after the commit, never inside it (ADR-0015)`;

  // Read at call time, not at import: a test needs to exercise both branches,
  // and there is no cost to a comparison per published event.
  if (process.env.NODE_ENV !== "production") {
    throw new Error(message);
  }

  console.error(message);
  Sentry.withScope((scope) => {
    scope.setTag("component", "events");
    scope.setTag("event", event.kind);
    scope.setContext("event", { ...event });
    Sentry.captureMessage("event published inside a transaction", "error");
  });
}

/**
 * Fan one event out to everyone allowed to hear it.
 *
 * The audience decision is `EVENT_AUDIENCE`'s alone — a `Record` over the event
 * union, so a new kind cannot ship until somebody says who receives it. Deciding
 * it here rather than at the publish sites means there is one place a disclosure
 * bug can live, and it is a table.
 *
 * **Throws for exactly one reason, and never in production.** A publisher is a
 * route that has already committed or a job that has already answered a
 * customer, so a failed fan-out must not turn either of those into an error —
 * every per-subscriber failure below is swallowed, the same discipline as
 * `recordActivity` in `ticket-activity.ts`. The single exception is
 * `refuseInsideTransaction` above, which throws outside production because being
 * called there means the caller has the ordering wrong and nothing else would
 * say so. Its note is the whole argument.
 *
 * This is also the seam for multiple API replicas. Today the fan-out is
 * in-process, which is honest at one instance and silently wrong at two — an
 * agent on replica A hears nothing about a ticket a job on replica B just
 * resolved. The day that matters, this function gains a Postgres `NOTIFY` and a
 * listener calls the local loop below. **No call site changes**, which is the
 * whole reason `publish` is the only way in — and the same property is what let
 * the transaction guard land here without touching one either.
 */
export function publish(event: TicketEvent): void {
  refuseInsideTransaction(event);

  const audience = EVENT_AUDIENCE[event.kind];

  for (const connection of connections) {
    if (audience !== "all" && connection.role !== audience) continue;
    try {
      connection.send(event);
    } catch (error) {
      console.error("[events] failed to send to a subscriber:", error);
    }
  }
}

/**
 * End every stream.
 *
 * Called from `shutdown()` **before** `stopJobs()`. `server.close()` alone will
 * not do it: it stops accepting new connections and leaves in-flight responses
 * running, and an event stream is in-flight forever by definition. Without this,
 * a redeploy leaves every tab hopefully attached to a dying process until some
 * intermediary times the socket out — which reads as an outage.
 */
export function closeAll(): void {
  for (const connection of connections) {
    try {
      connection.close();
    } catch (error) {
      console.error("[events] failed to close a subscriber:", error);
    }
  }
  connections.clear();
}

/** Open streams. For the health/debug surface and for tests. */
export function connectionCount(): number {
  return connections.size;
}
