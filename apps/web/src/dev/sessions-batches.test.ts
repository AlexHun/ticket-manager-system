import { describe, expect, test } from "vitest";
import {
  SESSION_GROUP_KIND,
  type SessionGroup,
  type SessionSlice,
} from "./sessions-protocol";
import { cardsIn, drawnGroups } from "./sessions-batches";

/**
 * How much of a reading the page draws in each batch (#618). A reading of
 * this machine's sessions was 1,230 cards, and drawing them in one commit held
 * the first card back 14.7s after the reading had arrived; so the page draws
 * the first few cards and adds the rest a batch at a time. Tested over
 * made-up readings, as `sessions-filter.test.ts` is.
 */

const slice = (id: string, children: SessionSlice[] = []): SessionSlice => ({
  id,
  out: 1,
  subtreeOut: 1 + children.reduce((n, child) => n + child.subtreeOut, 0),
  children,
});

const group = (key: string, sessions: SessionSlice[]): SessionGroup => ({
  key,
  kind: SESSION_GROUP_KIND.other,
  out: 1_000,
  sessions,
});

// Six cards in all: a session of three, then three sessions of one.
const GROUPS = [
  group("first", [slice("parent", [slice("child", [slice("grandchild")])])]),
  group("second", [slice("a"), slice("b")]),
  group("third", [slice("c")]),
];

const drawnOf = (groups: SessionGroup[]) =>
  groups.map((g) => [g.key, g.sessions.map((s) => s.id)]);

describe("cardsIn", () => {
  test("counts every card a group draws, subagents at any depth included", () => {
    expect(cardsIn(GROUPS)).toBe(6);
    expect(cardsIn([])).toBe(0);
  });
});

describe("drawnGroups", () => {
  test("a later budget keeps every group the earlier one drew whole as it was", () => {
    // The page memoises a group by identity, so a batch renders only the
    // groups it changes.
    const earlier = drawnGroups(GROUPS, 4);
    const later = drawnGroups(GROUPS, 5);
    expect(later[0]).toBe(earlier[0]);
    expect(later[0]).toBe(GROUPS[0]);
    expect(later[1]!.sessions[0]).toBe(earlier[1]!.sessions[0]);
  });

  test("a budget covering every card draws the reading as it is", () => {
    expect(drawnGroups(GROUPS, 6)).toBe(GROUPS);
    expect(drawnGroups(GROUPS, 100)).toBe(GROUPS);
  });

  test("draws the sessions in the page's order until the budget is spent", () => {
    expect(drawnOf(drawnGroups(GROUPS, 4))).toEqual([
      ["first", ["parent"]],
      ["second", ["a"]],
    ]);
  });

  test("a budget spent at a group's end leaves every later group out", () => {
    expect(drawnOf(drawnGroups(GROUPS, 5))).toEqual([
      ["first", ["parent"]],
      ["second", ["a", "b"]],
    ]);
  });

  test("never splits a session from its subagents, so the first is drawn whole", () => {
    // A budget of one still draws the session of three: the first card on
    // the page is never held back, and a tree is never drawn in part.
    const drawn = drawnGroups(GROUPS, 1);
    expect(drawnOf(drawn)).toEqual([["first", ["parent"]]]);
    expect(drawn[0]!.sessions[0]).toBe(GROUPS[0]!.sessions[0]);
  });

  test("a group cut short keeps the issue's whole total", () => {
    const drawn = drawnGroups(GROUPS, 4);
    expect(drawn[1]!.out).toBe(1_000);
  });

  test("a reading with no sessions draws nothing", () => {
    expect(drawnGroups([], 10)).toEqual([]);
  });
});
