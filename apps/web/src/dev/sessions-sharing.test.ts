import { describe, expect, test } from "vitest";
import {
  SESSION_GROUP_KIND,
  SESSION_STATE,
  type SessionCard,
  type SessionGroup,
  type SessionSlice,
  type SessionState,
  type SessionsReport,
} from "./sessions-protocol";
import { shareReading } from "./sessions-sharing";

/**
 * What a new reading keeps of the last one (#689). Each reading arrives as new
 * objects, so without this every memoised card on the page re-rendered on
 * every reading. Tested over made-up readings, as `sessions-batches.test.ts`
 * is; each reading is built afresh, as the stream's parse builds it.
 */

const card = (
  id: string,
  state: SessionState = SESSION_STATE.running,
  children: SessionCard[] = [],
): SessionCard => ({
  id,
  subagentType: null,
  task: `Task ${id}`,
  model: null,
  state,
  startedAt: null,
  elapsedMs: null,
  step: null,
  tools: [{ name: "Bash", calls: 1 }],
  children,
});

const slice = (
  id: string,
  out = 1,
  children: SessionSlice[] = [],
): SessionSlice => ({
  id,
  out,
  subtreeOut: out + children.reduce((n, child) => n + child.subtreeOut, 0),
  children,
});

const group = (key: string, sessions: SessionSlice[]): SessionGroup => ({
  key,
  kind: SESSION_GROUP_KIND.other,
  out: sessions.reduce((n, s) => n + s.subtreeOut, 0),
  sessions,
});

const report = (
  sessions: SessionCard[],
  groups: SessionGroup[],
  gatheredAt = "2026-11-01T10:00:00.000Z",
): SessionsReport => ({
  transcriptDir: "/transcripts",
  gatheredAt,
  sessions,
  groups,
  chains: [],
  warnings: [],
});

/** A session with two subagents, and a second session, in one group each. */
const reading = (
  firstChildState: SessionState = SESSION_STATE.running,
  firstChildOut = 1,
) =>
  report(
    [
      card("s1", SESSION_STATE.running, [
        card("a1", firstChildState),
        card("a2"),
      ]),
      card("s2", SESSION_STATE.done),
    ],
    [
      group("first", [
        slice("s1", 1, [slice("a1", firstChildOut), slice("a2")]),
      ]),
      group("second", [slice("s2")]),
    ],
  );

describe("shareReading", () => {
  test("the first reading is drawn as it arrives", () => {
    const next = reading();
    expect(shareReading(null, next)).toBe(next);
  });

  test("a reading that changes nothing but its clock keeps every card and group", () => {
    const previous = reading();
    const next = { ...reading(), gatheredAt: "2026-11-01T10:00:02.000Z" };
    const shared = shareReading(previous, next);
    expect(shared.gatheredAt).toBe("2026-11-01T10:00:02.000Z");
    expect(shared.sessions).toBe(previous.sessions);
    expect(shared.groups).toBe(previous.groups);
  });

  test("a subagent whose state changed is new, and so is every card above it, but not its sibling", () => {
    const previous = reading();
    const shared = shareReading(previous, reading(SESSION_STATE.done));
    const [s1, s2] = shared.sessions;
    expect(s1!.children[0]!.state).toBe(SESSION_STATE.done);
    expect(s1!.children[0]).not.toBe(previous.sessions[0]!.children[0]);
    expect(s1).not.toBe(previous.sessions[0]);
    expect(s1!.children[1]).toBe(previous.sessions[0]!.children[1]);
    expect(s2).toBe(previous.sessions[1]);
    // The state is the card's, never the slice's, so no group changed.
    expect(shared.groups).toBe(previous.groups);
  });

  test("a subagent that spent more is a new slice up its tree, and its group a new group, but the other group is kept", () => {
    const previous = reading();
    const shared = shareReading(previous, reading(SESSION_STATE.running, 5));
    const [first, second] = shared.groups;
    expect(first!.out).toBe(7);
    expect(first).not.toBe(previous.groups[0]);
    expect(first!.sessions[0]).not.toBe(previous.groups[0]!.sessions[0]);
    expect(first!.sessions[0]!.children[1]).toBe(
      previous.groups[0]!.sessions[0]!.children[1],
    );
    expect(second).toBe(previous.groups[1]);
    expect(shared.sessions).toBe(previous.sessions);
  });

  test("a new session at the top keeps every card below it, though each moved down a place", () => {
    const previous = reading();
    const next = reading();
    const shared = shareReading(
      previous,
      report([card("s0"), ...next.sessions], next.groups),
    );
    expect(shared.sessions.map((s) => s.id)).toEqual(["s0", "s1", "s2"]);
    expect(shared.sessions[1]).toBe(previous.sessions[0]);
    expect(shared.sessions[2]).toBe(previous.sessions[1]);
    expect(shared.sessions).not.toBe(previous.sessions);
  });

  test("a card that went away is gone, and its siblings are kept", () => {
    const previous = reading();
    const next = reading();
    const shared = shareReading(
      previous,
      report([next.sessions[1]!], next.groups),
    );
    expect(shared.sessions).toEqual([previous.sessions[1]]);
    expect(shared.sessions[0]).toBe(previous.sessions[1]);
  });

  test("a tool called once more is a new tally on a new card", () => {
    const previous = reading();
    const next = reading();
    next.sessions[1]!.tools[0]!.calls = 2;
    const shared = shareReading(previous, next);
    expect(shared.sessions[1]!.tools).toEqual([{ name: "Bash", calls: 2 }]);
    expect(shared.sessions[1]).not.toBe(previous.sessions[1]);
    expect(shared.sessions[0]).toBe(previous.sessions[0]);
  });
});
