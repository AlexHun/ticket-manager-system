/**
 * Query keys for the admin activity feed.
 *
 * Written down for the same reason `ticketKeys` is: the feed is read on one
 * page, under a key that carries its filters, and it is written to from four
 * other files that never render it — every admin mutation on a user appends an
 * `AdminActivity` row as a side effect. A key spelled by hand at each of those
 * call sites is a key that silently stops matching the one the page reads.
 *
 * `list` nests under `all`, so one invalidate reaches every cached page and
 * filter combination.
 */
export const activityKeys = {
  all: ["activity"] as const,

  /** One page of the feed. The params object is part of the key. */
  list: (params: object) => ["activity", params] as const,
};
