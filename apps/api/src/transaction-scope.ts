import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Whether the code running right now is inside an interactive
 * `prisma.$transaction` callback — and the wrapper that makes that knowable.
 *
 * One rule needs it, and `events/hub.ts` is the only reader: **publish after the
 * commit that made the fact true, never inside the transaction.** A subscriber
 * that refetched on an event published mid-transaction can read pre-commit
 * state, cache it, and then never be told again, because the event that would
 * have corrected it has already been spent. The repo has met that shape of bug
 * once already — "NOTIFY fires on insert, not when a retry becomes due" in
 * `jobs/boss.ts` — and it fails silently both times.
 *
 * ADR-0015 chose to enforce that half of the rule here rather than to build the
 * `transition()` module the six ticket-write sites could not have shared. The
 * trade it names is the reason this file is small: the guard costs one wrapper
 * where each client is constructed and **nothing at any call site**, which is
 * the same property that makes `publish` the seam a multi-replica fan-out would
 * use.
 *
 * **A leaf whose only import is `node:async_hooks`, deliberately.** It is read
 * by `events/hub.ts` and applied by both `db.ts` and `src/test/pg.ts`, so
 * anything it pulled in would be pulled in by all three — and `mock.module`'s
 * registry is one process wide, so a module worth replacing on one of those
 * paths is one file-ordering away from being replaced on the others. That is
 * the argument `auth-tokens.ts` already makes, in the same words, after it cost
 * a green local run and a red CI one (#158). Nothing mocks a leaf with no
 * imports; keep it one.
 *
 * ## What was measured, because the whole design rests on it
 *
 * On this repo's stack — Bun 1.3.13, Prisma 7.9.1, PGLite through
 * `src/test/pg.ts` — the store is visible synchronously inside the callback,
 * still visible after an awaited Prisma call, still visible inside a nested
 * `async` helper (the shape `sendReply(…, tx)` has), absent again once the
 * transaction resolves, and **absent on a concurrent non-transactional path
 * running beside an open one** — the case that would have made the guard
 * useless the day a second worker runs. `events/publish-in-transaction.test.ts`
 * is each of those as an assertion rather than a claim.
 *
 * The **array** form (`$transaction([…])`) takes no callback, so nothing can run
 * inside one and it enters no scope. It is handed straight on, untouched, which
 * is also what keeps `routes/users.ts`'s `DELETE` batching — the property
 * `src/test/pg.ts` records a client extension would have broken.
 */
const scope = new AsyncLocalStorage<true>();

/** True while an interactive `prisma.$transaction` callback is on the stack. */
export function inTransaction(): boolean {
  return scope.getStore() === true;
}

/**
 * Wrap a Prisma client so its interactive `$transaction` runs inside the scope.
 *
 * Applied where a client is *constructed* — `db.ts` for the app, `test/pg.ts`
 * for the suite — because those are the two clients that exist, and a guard the
 * test client did not have would be a guard no test could ever fail on. Since
 * #175 the suite reaches `../db` through a preload that hands it the second one,
 * so wrapping only the first would have left the whole API suite unguarded while
 * reading as though it were covered.
 *
 * **A proxy rather than an assignment to `client.$transaction`.** Both were
 * measured to work on the pinned Prisma, and the assignment is shorter — but
 * `$transaction` is neither an own property of the client nor on its prototype;
 * it is resolved by Prisma's own proxy, and an assignment that happens to shadow
 * that is depending on an internal. Here every property but `$transaction` is
 * read straight off the target, and `$`- and `_`-prefixed functions are bound to
 * it for the reason `test/pg.ts` gives for the identical line: they read `this`,
 * and a proxy is not it.
 */
export function scopeTransactions<T extends object>(client: T): T {
  return new Proxy(client, {
    get(target, property) {
      // `target` as the receiver, not the proxy: a getter on the client must
      // resolve against the real object, never against this wrapper.
      const value = Reflect.get(target, property, target);

      if (property === "$transaction" && typeof value === "function") {
        const run = value as (...args: unknown[]) => unknown;
        return (...args: unknown[]) => {
          const [first, ...rest] = args;
          // The array form: no callback, nothing that could publish, hand it on
          // exactly as it came so the batch still batches.
          if (typeof first !== "function") return run.apply(target, args);

          const body = first as (tx: unknown) => unknown;
          return run.apply(target, [
            (tx: unknown) => scope.run(true, () => body(tx)),
            ...rest,
          ]);
        };
      }

      if (
        typeof property === "string" &&
        (property.startsWith("$") || property.startsWith("_")) &&
        typeof value === "function"
      ) {
        return value.bind(target);
      }

      return value;
    },
  });
}
