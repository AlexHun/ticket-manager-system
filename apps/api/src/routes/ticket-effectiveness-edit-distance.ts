/**
 * `avgEditDistance` on `AssistantEffectivenessResponse` — see the field comment
 * in `@ticket/shared` for the numbers that ruled out a plain O(n·m) DP: a
 * worst-case 10,000-character pair (`MAX_MESSAGE_BODY_LENGTH`) took 14-18s, and
 * even 50 pairs of ordinary ~400-character replies took ~1s, computed inline
 * inside the request that serves this endpoint.
 *
 * `editDistance` is Ukkonen's banded Levenshtein: it only fills DP cells within
 * a diagonal band of radius `k` around the main diagonal, re-trying with a
 * doubled `k` whenever the true distance turns out to exceed the band it just
 * tried. A lightly-edited draft — the common case this field exists to
 * measure — has a small true distance, so the very first (smallest) band
 * already contains it and the whole computation costs `O(k · length)` rather
 * than `O(length²)`. The band only grows to cover the full matrix when the two
 * strings are genuinely unrelated, which degrades to the same cost the naive
 * approach always paid — but only for that rarer pair, not for every one.
 *
 * Kept in its own module, importing nothing from `../db`, for the same reason
 * `ticket-effectiveness-override.ts` is: a `bun test` file can exercise it
 * directly against plain strings without touching the process-wide `../db`
 * mock registry — see `ticket-effectiveness.test.ts` and the "registry is one
 * process wide" note in `docs/standards/testing.md`.
 */

const UNBOUNDED = Number.MAX_SAFE_INTEGER;

/**
 * Exact Levenshtein distance restricted to a diagonal band of radius `k`.
 *
 * Cells outside the band (`|i - j| > k`) are never allocated; a lookup that
 * would land outside the band the previous row was computed with reads as
 * `UNBOUNDED` rather than a stale value from array reuse. Returns a value
 * `> k` when the true distance exceeds the band — the caller decides whether
 * that means "retry with a wider band" or "wide enough, this is exact."
 */
function bandedDistance(a: string, b: string, k: number): number {
  const n = a.length;
  const m = b.length;
  if (Math.abs(n - m) > k) return k + 1;

  let prev = new Int32Array(m + 1);
  let curr = new Int32Array(m + 1);
  let prevLo = 0;
  let prevHi = Math.min(m, k);
  for (let j = prevLo; j <= prevHi; j++) prev[j] = j;

  const prevAt = (lo: number, hi: number, j: number): number =>
    j < lo || j > hi ? UNBOUNDED : prev[j];

  for (let i = 1; i <= n; i++) {
    const jLo = Math.max(0, i - k);
    const jHi = Math.min(m, i + k);
    if (jLo === 0) curr[0] = i;

    for (let j = Math.max(1, jLo); j <= jHi; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      const substitute = prevAt(prevLo, prevHi, j - 1) + cost;
      const deleteFromA = prevAt(prevLo, prevHi, j) + 1;
      const insertFromB = (j - 1 >= jLo ? curr[j - 1] : UNBOUNDED) + 1;
      curr[j] = Math.min(substitute, deleteFromA, insertFromB);
    }

    const swap = prev;
    prev = curr;
    curr = swap;
    prevLo = jLo;
    prevHi = jHi;
  }

  return prevAt(prevLo, prevHi, m);
}

/**
 * Exact Levenshtein distance between `a` and `b`.
 *
 * Starts the band at the one radius no true distance can be smaller than —
 * `|len(a) - len(b)|` — and doubles it only if that band turns out too narrow.
 * Once the band reaches `max(len(a), len(b))` it necessarily covers the whole
 * matrix, so the result at that point is exact regardless of the `> k` check.
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const n = a.length;
  const m = b.length;
  if (n === 0) return m;
  if (m === 0) return n;

  const full = Math.max(n, m);
  let k = Math.min(Math.max(1, Math.abs(n - m)), full);

  while (true) {
    const distance = bandedDistance(a, b, k);
    if (distance <= k || k >= full) return distance;
    k = Math.min(k * 2, full);
  }
}

export interface EditDistancePair {
  polishedDraft: string | null;
  textBody: string | null;
}

/**
 * Average edit distance over every pair that actually has both halves.
 *
 * Takes the row shape the Prisma query returns rather than requiring the
 * caller to have already filtered `not: null` — the query does filter on
 * both columns, but a defensive skip here means this stays correct even if a
 * future caller forgets to, the same trade `countCategoryOverrides` makes for
 * its own rows. `null` — not `0` — when there are no pairs to average, since a
 * rate of zero and "nothing measured yet" are different facts.
 */
export function averageEditDistance(pairs: EditDistancePair[]): number | null {
  let total = 0;
  let count = 0;
  for (const { polishedDraft, textBody } of pairs) {
    if (polishedDraft === null || textBody === null) continue;
    total += editDistance(polishedDraft, textBody);
    count++;
  }
  return count === 0 ? null : total / count;
}
