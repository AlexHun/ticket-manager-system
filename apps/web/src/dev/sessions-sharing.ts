import type { SessionsReport } from "./sessions-protocol";

/**
 * `next` with every part `previous` already held kept as `previous`'s object
 * (#689), so the page's memoised `Group` and `CardBody` skip whatever a
 * reading did not change. Each reading arrives as new objects, and before this
 * every drawn card re-rendered on every reading: measured 2026-11-01 on this
 * machine's 1,300 cards, 2.6-4.9s of main thread per reading, all of it React.
 *
 * A part that changed is new, and so is everything above it, so a card is
 * kept only when its whole subtree is. A list's items are matched by their
 * `id`, or a group's `key`, so a new session at the top keeps the cards it
 * pushes down; an item with neither is matched by its place.
 */
export function shareReading(
  previous: SessionsReport | null,
  next: SessionsReport,
): SessionsReport {
  return previous === null ? next : (share(previous, next) as SessionsReport);
}

/** `next`, or `previous` wherever the two hold the same JSON. */
function share(previous: unknown, next: unknown): unknown {
  if (previous === next) return previous;
  if (Array.isArray(previous) && Array.isArray(next)) {
    return shareList(previous, next);
  }
  if (isRecord(previous) && isRecord(next)) return shareRecord(previous, next);
  return next;
}

function shareList(previous: unknown[], next: unknown[]): unknown[] {
  const byIdentity = new Map<string, unknown>();
  for (const item of previous) {
    const identity = identityOf(item);
    if (identity !== null) byIdentity.set(identity, item);
  }
  const shared = next.map((item, i) => {
    const identity = identityOf(item);
    return share(
      identity === null ? previous[i] : byIdentity.get(identity),
      item,
    );
  });
  return shared.length === previous.length &&
    shared.every((item, i) => item === previous[i])
    ? previous
    : shared;
}

function shareRecord(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const shared: Record<string, unknown> = {};
  let same = Object.keys(previous).length === Object.keys(next).length;
  for (const [key, value] of Object.entries(next)) {
    shared[key] = share(previous[key], value);
    if (shared[key] !== previous[key] || !(key in previous)) same = false;
  }
  return same ? previous : shared;
}

/** What matches a list item to its counterpart in the last reading. */
function identityOf(item: unknown): string | null {
  if (!isRecord(item)) return null;
  if (typeof item.id === "string") return `id:${item.id}`;
  if (typeof item.key === "string") return `key:${item.key}`;
  return null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
