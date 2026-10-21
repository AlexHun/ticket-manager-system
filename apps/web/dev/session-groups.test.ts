import { describe, expect, it } from "vitest";
import { groupSessions, type CreditedCard } from "./session-groups.ts";
import { tallySpend, type TranscriptResponse } from "./transcripts.ts";
import type {
  SessionGroup,
  SessionSlice,
} from "../src/dev/sessions-protocol.ts";

/**
 * Slice 4 of `docs/plans/dev-tools-sessions-page.md` (#593): each response
 * credited to its card, and the cards grouped by the branch each response ran
 * on. Made-up cards, no files: the reading that builds them is
 * `./sessions.test.ts`'s.
 */

let next = 0;
const response = (
  branch: string | null,
  out: number,
  id = `line:${next++}`,
): TranscriptResponse => ({
  id,
  session: "s",
  branch,
  at: null,
  out,
  cacheRead: 0,
});

const card = (
  id: string,
  responses: TranscriptResponse[],
  children: CreditedCard[] = [],
  branch: string | null = responses.at(-1)?.branch ?? null,
): CreditedCard => ({ id, branch, responses, children });

/** `key: id=out/subtreeOut` lines, indented by depth, for one group. */
const shape = (slices: SessionSlice[], depth = 0): string[] =>
  slices.flatMap((s) => [
    `${"  ".repeat(depth)}${s.id}=${s.out}/${s.subtreeOut}`,
    ...shape(s.children, depth + 1),
  ]);

const groupOf = (groups: SessionGroup[], key: string) => {
  const group = groups.find((g) => g.key === key);
  if (!group) throw new Error(`no group ${key}`);
  return group;
};

describe("groupSessions", () => {
  it("totals a card's own responses and its subtree's, within the group", () => {
    const groups = groupSessions([
      card(
        "s",
        [response("feat/7-x", 100)],
        [
          card(
            "a",
            [response("feat/7-x", 20)],
            [card("b", [response("feat/7-x", 3)])],
          ),
        ],
      ),
    ]);

    expect(groups.map((g) => g.key)).toEqual(["issue:7"]);
    const [group] = groups;
    expect(group).toMatchObject({ kind: "issue", issue: 7, out: 123 });
    expect(shape(group!.sessions)).toEqual([
      "s=100/123",
      "  a=20/23",
      "    b=3/3",
    ]);
  });

  it("splits a session that worked on several branches into each one's group, with its share of each", () => {
    const groups = groupSessions([
      card(
        "s",
        [
          response("feat/7-x", 100),
          response("main", 5),
          response("feat/8-y", 40),
        ],
        [card("a", [response("feat/8-y", 2)])],
      ),
    ]);

    expect(shape(groupOf(groups, "issue:7").sessions)).toEqual(["s=100/100"]);
    expect(shape(groupOf(groups, "issue:8").sessions)).toEqual([
      "s=40/42",
      "  a=2/2",
    ]);
    expect(shape(groupOf(groups, "base").sessions)).toEqual(["s=5/5"]);
  });

  it("puts develop and main in one group of their own, and a branch naming no issue or none at all in another", () => {
    const groups = groupSessions([
      card("s", [
        response("develop", 1),
        response("main", 10),
        response("chore/no-issue", 100),
        response(null, 1000),
      ]),
    ]);

    expect(groupOf(groups, "base")).toMatchObject({ kind: "base", out: 11 });
    expect(groupOf(groups, "other")).toMatchObject({
      kind: "other",
      out: 1100,
    });
    expect(groups.filter((g) => g.kind === "issue")).toEqual([]);
  });

  it("totals an issue as the Usage page does, over the same responses", () => {
    const responses = [
      response("feat/7-x", 100),
      response("fix/7-again", 30),
      response("develop", 9),
      response("main", 5),
      response("feat/8-y", 40),
    ];
    const roots = [
      card("s", responses.slice(0, 3), [card("a", responses.slice(3))]),
    ];

    const groups = groupSessions(roots);

    const { byIssue } = tallySpend(responses);
    for (const [issue, spend] of byIssue) {
      const group = groupOf(groups, `issue:${issue}`);
      expect(group.out).toBe(spend.out);
      expect(group.sessions.reduce((n, s) => n + s.subtreeOut, 0)).toBe(
        spend.out,
      );
    }
    expect(groupOf(groups, "issue:7").out).toBe(130);
  });

  it("credits a response found in two cards' files once, to the first, at its larger count", () => {
    const groups = groupSessions([
      card(
        "s",
        [response("feat/7-x", 10, "message:m1")],
        [card("a", [response("feat/7-x", 500, "message:m1")])],
      ),
    ]);

    expect(shape(groupOf(groups, "issue:7").sessions)).toEqual([
      "s=500/500",
      "  a=0/0",
    ]);
  });

  it("puts a card with no responses where its latest record is, or where its parent's is", () => {
    const groups = groupSessions([
      card(
        "s",
        [response("feat/7-x", 100)],
        [
          // Started on another branch, with nothing spent yet.
          card("a", [], [], "feat/8-y"),
          // A meta file and no transcript: nothing to say where it is.
          card("b", [], [], null),
        ],
      ),
    ]);

    expect(shape(groupOf(groups, "issue:7").sessions)).toEqual([
      "s=100/100",
      "  b=0/0",
    ]);
    expect(shape(groupOf(groups, "issue:8").sessions)).toEqual([
      "s=0/0",
      "  a=0/0",
    ]);
  });

  it("lists issue groups by their most recent session, then develop and main, then the rest", () => {
    const groups = groupSessions([
      card("newer", [
        response("other/x", 1),
        response("main", 1),
        response("feat/9-z", 1),
        response("feat/3-c", 1),
      ]),
      card("older", [response("feat/1-a", 1), response("main", 1)]),
    ]);

    expect(groups.map((g) => g.key)).toEqual([
      "issue:3",
      "issue:9",
      "issue:1",
      "base",
      "other",
    ]);
    expect(groupOf(groups, "base").sessions.map((s) => s.id)).toEqual([
      "newer",
      "older",
    ]);
  });

  it("answers no groups for no sessions", () => {
    expect(groupSessions([])).toEqual([]);
  });
});
