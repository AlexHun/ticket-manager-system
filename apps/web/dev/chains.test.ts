import { describe, expect, it } from "vitest";
import {
  chainArgsOf,
  chainPlanOf,
  chainView,
  createChainLister,
  workerOf,
} from "./chains.ts";
import {
  ISSUE_STATE,
  type ChainListing,
  type ListedChainIssue,
} from "./issues.ts";
import {
  CHAIN_ISSUE_STATE,
  SESSION_STATE,
  type ChainWorker,
} from "../src/dev/sessions-protocol.ts";

/**
 * Slice 5 of `docs/plans/dev-tools-sessions-page.md` (#594): where a running
 * `/chain` stands, from its conductor's transcript and the one `gh issue list`
 * call `chain` step 1 makes.
 */

const PLAN = "docs/plans/fixture-chain.md";

const listed = (
  number: number,
  state: ListedChainIssue["state"],
  blockedBy: [number, ListedChainIssue["state"]][] = [],
): ListedChainIssue => ({
  number,
  title: `Fixture #${number}`,
  state,
  blockedBy: blockedBy.map(([n, s]) => ({ number: n, state: s })),
});

const listing = (...issues: ListedChainIssue[]): ChainListing => ({
  issues,
  warning: null,
});

const worker = (
  name: string,
  issue: number,
  state: ChainWorker["state"] = SESSION_STATE.running,
): ChainWorker => ({ name, issue, cardId: `a-${name}`, state });

const { open, closed } = ISSUE_STATE;

describe("chainArgsOf", () => {
  it("reads what /chain was given off the prompt Claude Code records for it", () => {
    expect(
      chainArgsOf(
        "<command-message>chain</command-message>\n<command-name>/chain</command-name>\n<command-args>docs/plans/x.md auto</command-args>",
      ),
    ).toBe("docs/plans/x.md auto");
  });

  it("answers null for any other command, and for a prompt that only mentions it", () => {
    expect(
      chainArgsOf(
        "<command-name>/clear</command-name>\n<command-args></command-args>",
      ),
    ).toBeNull();
    expect(chainArgsOf("Run /chain docs/plans/x.md for me")).toBeNull();
  });

  it("reads /chain off a prompt that opens on <command-name> rather than <command-message>", () => {
    expect(
      chainArgsOf(
        "<command-name>/chain</command-name>\n<command-message>chain</command-message>\n<command-args>#1 #2</command-args>",
      ),
    ).toBe("#1 #2");
  });

  it("answers null for a prompt that only quotes the markup further in (#682)", () => {
    expect(
      chainArgsOf(
        "How is it recorded? As <command-name>/chain</command-name><command-args>docs/plans/x.md</command-args>",
      ),
    ).toBeNull();
    expect(
      chainArgsOf(
        "<bash-stdout>a.jsonl: <command-name>/chain</command-name><command-args>docs/plans/x.md</command-args></bash-stdout><bash-stderr></bash-stderr>",
      ),
    ).toBeNull();
  });

  it("answers an empty string for /chain given nothing", () => {
    expect(chainArgsOf("<command-name>/chain</command-name>")).toBe("");
  });
});

describe("chainPlanOf", () => {
  it("finds the plan or PRD path among the arguments", () => {
    expect(chainPlanOf("docs/plans/x.md auto")).toBe("docs/plans/x.md");
    expect(chainPlanOf("auto docs/prd/y-z.md")).toBe("docs/prd/y-z.md");
  });

  it("reads a Windows path or one written from ./ as the path issues name", () => {
    expect(chainPlanOf("docs\\plans\\x.md")).toBe("docs/plans/x.md");
    expect(chainPlanOf("./docs/plans/x.md auto")).toBe("docs/plans/x.md");
    expect(chainPlanOf(".\\docs\\prd\\y.md")).toBe("docs/prd/y.md");
  });

  it("answers null for a chain given issue numbers", () => {
    expect(chainPlanOf("397-401 auto")).toBeNull();
    expect(chainPlanOf("")).toBeNull();
  });
});

describe("workerOf", () => {
  it("reads the worker's name and issue off chain's prompt", () => {
    expect(
      workerOf({
        description: "Ember implements issue #535",
        prompt:
          "You are Ember, on the team. Invoke the `implement` skill for issue #535 and follow it to the end.",
      }),
    ).toEqual({ name: "Ember", issue: 535 });
  });

  it("answers null for any other subagent's call", () => {
    expect(workerOf({ prompt: "Review the diff since origin/develop." })).toBe(
      null,
    );
    expect(workerOf({})).toBeNull();
    expect(workerOf(null)).toBeNull();
  });
});

describe("chainView", () => {
  it("orders the issues blockers first, ties by number, and marks merged, in progress and next", () => {
    const view = chainView(
      { sessionId: "c", plan: PLAN, workers: [worker("Flint", 202)] },
      // Listed out of order: the order comes from the blockers and the
      // numbers, never from where gh happens to print an issue.
      listing(
        listed(203, open, [[201, closed]]),
        listed(204, open, [[203, open]]),
        listed(202, open, [[201, closed]]),
        listed(201, closed),
      ),
    );

    expect(view.unknown).toBeNull();
    expect(view.issues?.map((i) => [i.issue, i.state, i.worker])).toEqual([
      [201, CHAIN_ISSUE_STATE.merged, null],
      [202, CHAIN_ISSUE_STATE.inProgress, "Flint"],
      [203, CHAIN_ISSUE_STATE.next, null],
      [204, CHAIN_ISSUE_STATE.waiting, null],
    ]);
  });

  it("puts a blocker in the chain before what it blocks, whatever its number", () => {
    const view = chainView(
      { sessionId: "c", plan: PLAN, workers: [] },
      listing(listed(301, open, [[305, open]]), listed(305, open)),
    );

    expect(view.issues?.map((i) => [i.issue, i.state])).toEqual([
      [305, CHAIN_ISSUE_STATE.next],
      [301, CHAIN_ISSUE_STATE.waiting],
    ]);
  });

  it("reads an issue whose blocker outside the chain is still open Blocked, naming it", () => {
    const view = chainView(
      { sessionId: "c", plan: PLAN, workers: [] },
      listing(
        listed(401, open, [
          [999, open],
          [998, closed],
        ]),
        listed(402, open),
      ),
    );

    expect(view.issues?.map((i) => [i.issue, i.state, i.blockers])).toEqual([
      [401, CHAIN_ISSUE_STATE.blocked, [999]],
      [402, CHAIN_ISSUE_STATE.next, []],
    ]);
  });

  it("names the latest worker on an issue a second worker resumed", () => {
    const view = chainView(
      {
        sessionId: "c",
        plan: PLAN,
        workers: [
          worker("Ember", 501, SESSION_STATE.stopped),
          worker("Flint", 501),
        ],
      },
      listing(listed(501, open)),
    );

    expect(view.issues?.[0]?.worker).toBe("Flint");
  });

  it("says the order is unknown without a listing, and keeps the workers", () => {
    const workers = [worker("Ember", 601, SESSION_STATE.done)];
    const view = chainView(
      { sessionId: "c", plan: PLAN, workers },
      { issues: null, warning: "`gh` could not list the issues." },
    );

    expect(view.issues).toBeNull();
    expect(view.unknown).toBe("`gh` could not list the issues.");
    expect(view.workers).toEqual(workers);
  });

  it("says the order is unknown for a chain given issue numbers rather than a plan", () => {
    const view = chainView(
      { sessionId: "c", plan: null, workers: [worker("Ember", 701)] },
      null,
    );

    expect(view.issues).toBeNull();
    expect(view.unknown).toMatch(/no plan/i);
    expect(view.workers).toHaveLength(1);
  });

  it("says the order is unknown when no issue names the plan", () => {
    const view = chainView(
      { sessionId: "c", plan: PLAN, workers: [] },
      listing(),
    );

    expect(view.issues).toBeNull();
    expect(view.unknown).toContain(PLAN);
  });
});

describe("createChainLister", () => {
  it("asks gh once per plan within its time to live, failures included", async () => {
    let calls = 0;
    let now = 0;
    const lister = createChainLister({
      env: {},
      ttlMs: 60_000,
      clock: () => now,
      list: () => {
        calls++;
        return Promise.resolve({ issues: [], warning: null });
      },
    });

    await lister(PLAN);
    await lister(PLAN);
    expect(calls).toBe(1);
    await lister("docs/plans/other.md");
    expect(calls).toBe(2);
    now = 60_001;
    await lister(PLAN);
    expect(calls).toBe(3);
  });

  it("reads the override file on every call, so the spec can take it away", async () => {
    let calls = 0;
    const lister = createChainLister({
      env: { GH_CHAIN_ISSUES_FILE: "listing.json" },
      ttlMs: 60_000,
      clock: () => 0,
      list: () => {
        calls++;
        return Promise.resolve({ issues: [], warning: null });
      },
    });

    await lister(PLAN);
    await lister(PLAN);
    expect(calls).toBe(2);
  });
});
