import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  TICKET_EVENT,
  type TicketEvent,
  type TicketScopedEvent,
} from "@ticket/shared";
import { prisma, resetDb } from "../test/pg";
import { publish, subscribe } from "./hub";

/**
 * `publish` refusing a call made inside an open transaction (#177, ADR-0015).
 *
 * The guard has two halves and this file is about both: `transaction-scope.ts`
 * has to *know* it is inside an interactive `$transaction`, and `hub.ts` has to
 * do the right thing with that in each environment.
 *
 * **The first half is the risky one, so it is asserted rather than asserted
 * about.** An `AsyncLocalStorage` is only as good as what it survives, and the
 * ADR rests on five measured properties: visible synchronously inside the
 * callback, visible after an awaited query, visible inside a nested `async`
 * helper — the shape `sendReply(…, tx)` has — gone once the transaction
 * resolves, and **absent on a concurrent path running beside an open one**. That
 * last one is the case that would have made the whole thing useless the day a
 * second worker runs, and it is the reason this file holds a transaction open
 * with a deferred rather than trusting an ordering.
 *
 * Nothing here mocks anything. `hub.ts` imports `@ticket/shared`, Sentry and one
 * import-free leaf, and the transaction is a real one on the in-process Postgres
 * — which is the point: a fake `$transaction` would be a fake of exactly the
 * mechanism under test.
 */

const NOT_PRODUCTION = /published inside a transaction/;

/**
 * A ticket-scoped event of whichever kind. `eval_run_changed` is the one kind
 * this cannot build — it names a run rather than a ticket — and it does not
 * need to: what is under test here is the transaction guard, which reads the
 * scope and not the payload.
 */
function event(
  kind: TicketScopedEvent["kind"] = TICKET_EVENT.ticket_updated,
): TicketEvent {
  return { kind, ticketId: 1, at: new Date().toISOString() };
}

/** Every event a subscriber actually received, whatever `publish` did after. */
function collect(): { heard: TicketEvent[]; stop: () => void } {
  const heard: TicketEvent[] = [];
  const stop = subscribe({
    role: "admin",
    send: (received) => heard.push(received),
    close: () => {},
  });
  return { heard, stop };
}

let unsubscribe: (() => void) | undefined;

beforeEach(async () => {
  await resetDb();
});

afterEach(() => {
  unsubscribe?.();
  unsubscribe = undefined;
  process.env.NODE_ENV = "test";
});

describe("outside production, publishing inside a transaction throws", () => {
  test("directly in the callback, after a query", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.ticket.count();
        publish(event());
      }),
    ).rejects.toThrow(NOT_PRODUCTION);
  });

  test("synchronously, before the callback has awaited anything", async () => {
    await expect(
      prisma.$transaction(async () => {
        publish(event());
      }),
    ).rejects.toThrow(NOT_PRODUCTION);
  });

  test("from a nested async helper the transaction awaited", async () => {
    // The shape that would actually happen: not a `publish` a reviewer can see
    // between the `$transaction` braces, but one two calls down — `sendReply(…,
    // tx)` is exactly this, and it is the reason the guard is at the seam rather
    // than a rule about what may appear in a callback body.
    const helper = async (tx: { ticket: { count: () => Promise<number> } }) => {
      await tx.ticket.count();
      publish(event(TICKET_EVENT.ticket_message));
    };

    await expect(
      prisma.$transaction(async (tx) => {
        await helper(tx);
      }),
    ).rejects.toThrow(NOT_PRODUCTION);
  });

  test("the throw rolls the transaction back", async () => {
    // Worth stating rather than leaving implied: outside production this guard
    // is not an annotation on a commit that happened anyway. The write does not
    // land, which is what makes a mis-ordered publish impossible to leave in.
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.ticket.create({
          data: {
            subject: "My login is broken",
            customerEmail: "customer@example.com",
            customerName: "Casey Customer",
          },
        });
        publish(event());
      }),
    ).rejects.toThrow(NOT_PRODUCTION);

    expect(await prisma.ticket.count()).toBe(0);
  });

  test("nothing reaches a subscriber", async () => {
    const { heard, stop } = collect();
    unsubscribe = stop;

    await expect(
      prisma.$transaction(async () => publish(event())),
    ).rejects.toThrow(NOT_PRODUCTION);

    expect(heard).toEqual([]);
  });
});

describe("everywhere else, publishing is untouched", () => {
  test("after the transaction resolves", async () => {
    const { heard, stop } = collect();
    unsubscribe = stop;

    await prisma.$transaction(async (tx) => {
      await tx.ticket.count();
    });
    publish(event());

    expect(heard).toHaveLength(1);
  });

  test("beside the array form, which enters no scope", async () => {
    // `$transaction([…])` takes no callback, so nothing can run inside one and
    // the wrapper hands it straight on. Asserted because a guard that fired here
    // would be a false positive on the batching form `routes/users.ts` needs.
    const { heard, stop } = collect();
    unsubscribe = stop;

    await prisma.$transaction([prisma.ticket.count(), prisma.user.count()]);
    publish(event());

    expect(heard).toHaveLength(1);
  });

  test("on a concurrent path, while another transaction is open", async () => {
    // The property the ADR measured and the one the guard would be useless
    // without: an async-local store must not leak sideways into whatever else
    // the process is doing. The transaction is genuinely held open — the
    // callback is parked on `held` — rather than merely started, so this is the
    // real overlap and not an ordering that happens to pass.
    const { heard, stop } = collect();
    unsubscribe = stop;

    let reached!: () => void;
    const inside = new Promise<void>((resolve) => (reached = resolve));
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));

    const open = prisma.$transaction(async (tx) => {
      await tx.ticket.count();
      reached();
      await held;
    });

    await inside;
    expect(() => publish(event())).not.toThrow();
    release();
    await open;

    expect(heard).toHaveLength(1);
  });
});

describe("in production it reports and fans out anyway", () => {
  test("the event still reaches subscribers, and the failure is logged", async () => {
    // A throw here would be a failed request, or a job that retries and
    // re-answers a customer, to prevent a screen that refreshes a moment late.
    // `NODE_ENV` is read at call time precisely so this branch is reachable.
    const { heard, stop } = collect();
    unsubscribe = stop;
    const logged = spyOn(console, "error").mockImplementation(() => {});
    process.env.NODE_ENV = "production";

    try {
      await prisma.$transaction(async (tx) => {
        await tx.ticket.count();
        publish(event(TICKET_EVENT.pipeline_changed));
      });

      expect(heard).toHaveLength(1);
      expect(heard[0]?.kind).toBe(TICKET_EVENT.pipeline_changed);
      expect(logged).toHaveBeenCalledTimes(1);
      expect(logged.mock.calls[0]?.[0]).toMatch(NOT_PRODUCTION);
    } finally {
      logged.mockRestore();
    }
  });
});
