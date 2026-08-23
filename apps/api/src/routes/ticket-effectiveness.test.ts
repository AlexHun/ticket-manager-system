/**
 * Unit tests for the two pieces of the effectiveness endpoint expressible as
 * pure functions over plain rows rather than a raw SQL string, and so the
 * pieces a `bun test` file (no database, per `docs/standards/testing.md`) can
 * actually exercise: `countCategoryOverrides` (`./ticket-effectiveness-override`)
 * and `editDistance`/`averageEditDistance`
 * (`./ticket-effectiveness-edit-distance`). `ticketEffectivenessHandler` calls
 * the first over exactly the rows `prisma.ticketActivity.findMany` would
 * return for `category_changed` activity in the slice, and the second over
 * exactly the rows `prisma.message.findMany` would return for outbound,
 * sent-and-polished messages in the slice.
 *
 * Deliberately does not import `./ticket-effectiveness` itself, which pulls in
 * `../db`: that specifier is process-wide `mock.module`d by `automation.test.ts`
 * and `outbound.test.ts` without spreading the real module, so importing
 * anything that reaches `../db` here would bind to whichever of those stubs
 * `bun test` happened to load first — see the "registry is one process wide"
 * note in `docs/standards/testing.md`.
 */

import { describe, expect, test } from "bun:test";
import { TICKET_ACTOR_KIND } from "@ticket/shared";
import {
  averageEditDistance,
  editDistance,
} from "./ticket-effectiveness-edit-distance";
import { countCategoryOverrides } from "./ticket-effectiveness-override";

describe("countCategoryOverrides", () => {
  test("classifier filed it, an agent later changed it: counted", () => {
    const rows = [
      { ticketId: 1, actorKind: TICKET_ACTOR_KIND.assistant },
      { ticketId: 1, actorKind: TICKET_ACTOR_KIND.agent },
    ];
    expect(countCategoryOverrides(rows)).toBe(1);
  });

  test("classifier filed it, nobody touched it since: not counted", () => {
    const rows = [{ ticketId: 1, actorKind: TICKET_ACTOR_KIND.assistant }];
    expect(countCategoryOverrides(rows)).toBe(0);
  });

  test("an agent filed it directly — the classifier never set a category: not counted", () => {
    // No assistant-authored row exists for this ticket, so there is nothing on
    // record for the agent to have overridden.
    const rows = [{ ticketId: 1, actorKind: TICKET_ACTOR_KIND.agent }];
    expect(countCategoryOverrides(rows)).toBe(0);
  });

  test("an agent changed it twice after the classifier: counted once, not twice", () => {
    const rows = [
      { ticketId: 1, actorKind: TICKET_ACTOR_KIND.assistant },
      { ticketId: 1, actorKind: TICKET_ACTOR_KIND.agent },
      { ticketId: 1, actorKind: TICKET_ACTOR_KIND.agent },
    ];
    expect(countCategoryOverrides(rows)).toBe(1);
  });

  test("mixed tickets: only the ones with both an assistant and an agent row count", () => {
    const rows = [
      // Ticket 1: overridden.
      { ticketId: 1, actorKind: TICKET_ACTOR_KIND.assistant },
      { ticketId: 1, actorKind: TICKET_ACTOR_KIND.agent },
      // Ticket 2: classifier only.
      { ticketId: 2, actorKind: TICKET_ACTOR_KIND.assistant },
      // Ticket 3: agent only — the classifier never reached it.
      { ticketId: 3, actorKind: TICKET_ACTOR_KIND.agent },
      // Ticket 4: overridden too.
      { ticketId: 4, actorKind: TICKET_ACTOR_KIND.assistant },
      { ticketId: 4, actorKind: TICKET_ACTOR_KIND.agent },
    ];
    expect(countCategoryOverrides(rows)).toBe(2);
  });

  test("no rows: zero", () => {
    expect(countCategoryOverrides([])).toBe(0);
  });
});

/** Textbook full-matrix Levenshtein, kept only in this test file as a slow but
 *  obviously-correct oracle for `editDistance` — the implementation under test
 *  exists specifically to avoid ever running this shape of loop over a
 *  10,000-character pair, so it stays here rather than being shared. */
function naiveDistance(a: string, b: string): number {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[n][m];
}

/** Deterministic PRNG (mulberry32) so the random cross-check below is
 *  reproducible rather than a source of one-in-a-while CI flakes. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomString(rand: () => number, maxLength: number): string {
  const alphabet = "ab ";
  const length = Math.floor(rand() * (maxLength + 1));
  let s = "";
  for (let i = 0; i < length; i++) {
    s += alphabet[Math.floor(rand() * alphabet.length)];
  }
  return s;
}

describe("editDistance", () => {
  test("identical strings: zero", () => {
    expect(editDistance("polish this reply", "polish this reply")).toBe(0);
  });

  test("one side empty: the length of the other", () => {
    expect(editDistance("", "hello")).toBe(5);
    expect(editDistance("hello", "")).toBe(5);
  });

  test("both sides empty: zero", () => {
    expect(editDistance("", "")).toBe(0);
  });

  test("a single substitution", () => {
    expect(editDistance("cat", "cut")).toBe(1);
  });

  test("a single insertion", () => {
    expect(editDistance("cat", "cats")).toBe(1);
  });

  test("a single deletion", () => {
    expect(editDistance("cats", "cat")).toBe(1);
  });

  test("completely disjoint strings: the naive worst case still comes out exact", () => {
    expect(editDistance("abcdef", "uvwxyz")).toBe(naiveDistance("abcdef", "uvwxyz"));
  });

  test("matches the textbook DP over random pairs", () => {
    const rand = mulberry32(1337);
    for (let i = 0; i < 300; i++) {
      const a = randomString(rand, 20);
      const b = randomString(rand, 20);
      expect(editDistance(a, b)).toBe(naiveDistance(a, b));
    }
  });

  test("a lightly-edited long reply resolves fast", () => {
    const base = "the quick brown fox jumps over the lazy dog ".repeat(200);
    const edited = `${base.slice(0, 100)}zzz${base.slice(103)}`;
    const start = performance.now();
    const distance = editDistance(base, edited);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(distance).toBe(3);
  });
});

describe("averageEditDistance", () => {
  test("no pairs: null, not zero", () => {
    expect(averageEditDistance([])).toBeNull();
  });

  test("skips pairs missing either half", () => {
    const pairs = [
      { polishedDraft: null, textBody: "hello" },
      { polishedDraft: "hello", textBody: null },
      { polishedDraft: "cat", textBody: "cut" },
    ];
    expect(averageEditDistance(pairs)).toBe(1);
  });

  test("averages across multiple pairs", () => {
    const pairs = [
      { polishedDraft: "cat", textBody: "cut" }, // distance 1
      { polishedDraft: "cat", textBody: "cats" }, // distance 1
      { polishedDraft: "hello", textBody: "world" }, // distance 4
    ];
    expect(averageEditDistance(pairs)).toBe(2);
  });
});
