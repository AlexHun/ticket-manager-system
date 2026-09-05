/**
 * How much one retention sweep may delete, and how long it may take doing it.
 *
 * Shared by `prune-outbox.ts` and `prune-activity-trails.ts`, which is the
 * whole reason this file exists: both had their own copy of all three numbers,
 * and the second file's comment conceded the duplication in prose — "Same
 * numbers and same reasoning as `prune-outbox.ts`". A comment saying two
 * constants must agree is a constant that wants to be one.
 *
 * They are genuinely one argument rather than two that happen to match. Both
 * sweeps do select-then-delete over a table built to grow forever, and for both
 * the sizing case is the *first* sweep on a deployment that has never had one:
 * everything ever written that is past its window goes at once, and a single
 * unbounded `DELETE` would hold locks for as long as that took. Everything
 * below follows from that one scenario.
 *
 * This is deliberately not in `./boss`. `SweepSpec.expireInSeconds` is
 * per-sweep because how long one sweep may legitimately take is a question only
 * the sweep can answer — the two that re-enqueue tickets borrow their worker's
 * 120s and have nothing to do with the numbers here. What is shared is "a
 * batched retention delete", not "a scheduled queue", so it lives beside the
 * two files that are one.
 */

/**
 * Rows deleted per statement, and how many statements one sweep may run.
 *
 * Capping the sweep rather than looping until empty is the same trade
 * `recoverStuck` makes: whatever is left is still there on the next tick, and a
 * job that cannot run long is a job that cannot block a deploy.
 */
export const BATCH_SIZE = 500;
export const MAX_BATCHES = 20;

/**
 * How long one sweep may be active before pg-boss assumes the process died.
 *
 * Five minutes, against a worst case of a handful of kinds or tables × twenty
 * batches of five hundred. Longer than the workers' expiry rather than shorter,
 * which is the opposite of what the cadence suggests: a worker is waiting on
 * one provider call, these are waiting on up to a hundred indexed statements.
 */
export const PRUNE_EXPIRE_IN_SECONDS = 300;
