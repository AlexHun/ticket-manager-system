import { describe, expect, test } from "vitest";
import {
  SESSION_GROUP_KIND,
  SESSION_STATE,
  type SessionCard,
  type SessionGroup,
  type SessionSlice,
  type SessionState,
} from "./sessions-protocol";
import { ALL_STATES, filterGroups } from "./sessions-filter";

/**
 * What the state filter above the groups keeps (#613). A session is kept when
 * it or any subagent under it, at any depth, is in the chosen state, since a
 * session waiting on nothing itself can hold the subagent that waits on you.
 * Tested over made-up readings rather than through the page, for the reason
 * `usage-facets.test.ts` gives: a predicate over every reading, not the few a
 * fixture happens to draw.
 */

const card = (
  id: string,
  state: SessionState,
  children: SessionCard[] = [],
): SessionCard => ({
  id,
  subagentType: null,
  task: null,
  model: null,
  state,
  startedAt: null,
  elapsedMs: null,
  step: null,
  tools: [],
  children,
});

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

/** Every card by its id, at any depth, as the page indexes them. */
const CARDS = new Map(
  [
    card("done", SESSION_STATE.done),
    card("running", SESSION_STATE.running),
    card("parent", SESSION_STATE.running, [
      card("child", SESSION_STATE.running, [
        card("grandchild", SESSION_STATE.waiting),
      ]),
    ]),
    card("stopped", SESSION_STATE.stopped),
  ]
    .flatMap(function all(c): SessionCard[] {
      return [c, ...c.children.flatMap(all)];
    })
    .map((c) => [c.id, c]),
);

const GROUPS = [
  group("first", [
    slice("done"),
    slice("parent", [slice("child", [slice("grandchild")])]),
  ]),
  group("second", [slice("running"), slice("stopped")]),
];

const keptOf = (groups: SessionGroup[]) =>
  groups.map((g) => [g.key, g.sessions.map((s) => s.id)]);

describe("filterGroups", () => {
  test("All keeps every group and session as it was", () => {
    expect(filterGroups(GROUPS, CARDS, ALL_STATES)).toBe(GROUPS);
  });

  test("keeps a session whose own card is in the state", () => {
    expect(keptOf(filterGroups(GROUPS, CARDS, SESSION_STATE.done))).toEqual([
      ["first", ["done"]],
    ]);
  });

  test("keeps a session for a subagent in the state at any depth, its tree whole", () => {
    const kept = filterGroups(GROUPS, CARDS, SESSION_STATE.waiting);
    expect(keptOf(kept)).toEqual([["first", ["parent"]]]);
    // The tree is drawn as it is, so the path to the waiting card is there.
    expect(kept[0]!.sessions[0]).toBe(GROUPS[0]!.sessions[1]);
  });

  test("keeps a session in a group whose slice carries none of its subagents", () => {
    // The waiting subagent worked on another branch, so this group's slice
    // of the session has no children; the session still waits on you.
    const elsewhere = [group("elsewhere", [slice("parent")])];
    expect(
      keptOf(filterGroups(elsewhere, CARDS, SESSION_STATE.waiting)),
    ).toEqual([["elsewhere", ["parent"]]]);
  });

  test("drops a group left with no session, and keeps each total as it was", () => {
    const kept = filterGroups(GROUPS, CARDS, SESSION_STATE.stopped);
    expect(keptOf(kept)).toEqual([["second", ["stopped"]]]);
    expect(kept[0]!.out).toBe(1_000);
  });

  test("a slice naming no card matches nothing", () => {
    const stray = [group("stray", [slice("missing")])];
    expect(filterGroups(stray, CARDS, SESSION_STATE.running)).toEqual([]);
  });
});
