import { EVENT_AUDIENCE, type TicketEvent, type UserRole } from "@ticket/shared";

/**
 * The set of open event streams, and nothing else.
 *
 * Split from `ticket-events.ts` the way `jobs/boss.ts` is split from the handlers
 * beside it: this file knows how to hold a connection and how to decide who hears
 * a thing, and knows no publisher by name. Every publisher goes through
 * `publish`, which is the property that makes the multi-instance upgrade
 * mechanical — see the note on `publish`.
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
 * Fan one event out to everyone allowed to hear it.
 *
 * The audience decision is `EVENT_AUDIENCE`'s alone — a `Record` over the event
 * union, so a new kind cannot ship until somebody says who receives it. Deciding
 * it here rather than at the publish sites means there is one place a disclosure
 * bug can live, and it is a table.
 *
 * **Never throws.** A publisher is a route that has already committed or a job
 * that has already answered a customer; a failed fan-out must not turn either of
 * those into an error. Same discipline, and the same reasoning, as
 * `recordActivity` in `ticket-activity.ts`.
 *
 * This is also the seam for multiple API replicas. Today the fan-out is
 * in-process, which is honest at one instance and silently wrong at two — an
 * agent on replica A hears nothing about a ticket a job on replica B just
 * resolved. The day that matters, this function gains a Postgres `NOTIFY` and a
 * listener calls the local loop below. **No call site changes**, which is the
 * whole reason `publish` is the only way in.
 */
export function publish(event: TicketEvent): void {
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
