// Where a running `/chain` stands — slice 5 of
// `docs/plans/dev-tools-sessions-page.md` (#594, R8).
//
// Two sources, read where each already is. The conductor's transcript says
// what `/chain` was given (Claude Code records the command as a prompt,
// `<command-name>/chain</command-name>` with its `<command-args>`) and which
// workers it started: each an `Agent` call whose prompt is the one `chain`
// step 2 writes, naming the worker and its issue. GitHub says which issues
// the plan has, which are closed and what blocks what, through the one
// `gh issue list` call `chain` step 1 makes (`./issues.ts`). The order is
// step 1's too: blockers first, ties by issue number.
//
// A chain given issue numbers rather than a plan names nothing to search
// for, and a missing `gh` answers nothing, so either way the order is
// unknown and the view still lists the workers the transcript shows, as the
// Usage page keeps its actuals without `gh`.

import {
  CHAIN_ISSUE_STATE,
  type ChainIssue,
  type ChainIssueState,
  type ChainView,
  type ChainWorker,
} from "../src/dev/sessions-protocol.ts";
import { CHAIN_ORDER_UNKNOWN } from "../src/dev/sessions-copy.ts";
import {
  CHAIN_ISSUES_FILE_ENV,
  ISSUE_STATE,
  fetchChainListing,
  type ChainListing,
  type ListedChainIssue,
} from "./issues.ts";

const CHAIN_COMMAND = /<command-name>\/chain<\/command-name>/;
/** A typed command's arguments, as Claude Code records them. */
export const COMMAND_ARGS = /<command-args>([\s\S]*?)<\/command-args>/;

/**
 * What `/chain` was given, off the prompt Claude Code records for the
 * command, or null for any other prompt. An empty string for `/chain` given
 * nothing.
 */
export function chainArgsOf(text: string): string | null {
  if (!CHAIN_COMMAND.test(text)) return null;
  return COMMAND_ARGS.exec(text)?.[1]?.trim() ?? "";
}

const PLAN_PATH = /(?:^|\s)(?:\.\/)?(docs\/(?:plans|prd)\/[\w.-]+\.md)(?=\s|$)/;

/** The plan or PRD path among `/chain`'s arguments, or null when it was given
 *  issue numbers. A Windows path or one written from `./` is read as the
 *  forward-slash path from the repo root, the form an issue's body names. */
export const chainPlanOf = (args: string): string | null =>
  PLAN_PATH.exec(args.replaceAll("\\", "/"))?.[1] ?? null;

/** The opening `chain` step 2 gives every worker's prompt. */
const WORKER_PROMPT =
  /^You are ([^\s,]+), on the team\. Invoke the `implement` skill for issue #(\d+)\b/;

/** The worker an `Agent` call's input starts, or null for any other call. */
export function workerOf(
  input: unknown,
): { name: string; issue: number } | null {
  const prompt = (input as { prompt?: unknown } | null)?.prompt;
  if (typeof prompt !== "string") return null;
  const match = WORKER_PROMPT.exec(prompt.trim());
  return match ? { name: match[1]!, issue: Number(match[2]) } : null;
}

/**
 * `issues` in `chain` step 1's order: an issue after every blocker of it in
 * the chain, and among those free to go, the lowest number first. A cycle,
 * which GitHub allows, is broken by number rather than dropping its issues.
 */
function orderChain(issues: ListedChainIssue[]): ListedChainIssue[] {
  const inChain = new Set(issues.map((i) => i.number));
  const left = [...issues].sort((a, b) => a.number - b.number);
  const placed = new Set<number>();
  const order: ListedChainIssue[] = [];
  while (left.length > 0) {
    const free = left.findIndex((i) =>
      i.blockedBy.every((b) => !inChain.has(b.number) || placed.has(b.number)),
    );
    const [issue] = left.splice(free === -1 ? 0 : free, 1);
    placed.add(issue!.number);
    order.push(issue!);
  }
  return order;
}

/** What the reader knows of a running chain before the listing is asked. */
export interface ChainSource {
  sessionId: string;
  plan: string | null;
  workers: ChainWorker[];
}

const NO_PLAN = `/chain was given issue numbers rather than a plan, so there is no plan to list the issues of, and ${CHAIN_ORDER_UNKNOWN}`;

/**
 * Where each issue of a running chain stands (`CHAIN_ISSUE_STATE`), in the
 * chain's order, from what the conductor's transcript says and the listing.
 * `listing` is null when there is no plan to ask about.
 */
export function chainView(
  source: ChainSource,
  listing: ChainListing | null,
): ChainView {
  const unknown = (why: string): ChainView => ({
    ...source,
    issues: null,
    unknown: why,
  });
  if (source.plan === null || listing === null) return unknown(NO_PLAN);
  if (listing.issues === null) {
    return unknown(
      listing.warning ?? `The listing is empty, so ${CHAIN_ORDER_UNKNOWN}`,
    );
  }
  if (listing.issues.length === 0) {
    return unknown(`No issue names ${source.plan}, so ${CHAIN_ORDER_UNKNOWN}`);
  }

  const inChain = new Set(listing.issues.map((i) => i.number));
  /** The latest worker started on each issue: one that resumed another's
   *  ticket is the one at work. */
  const workerOn = new Map(source.workers.map((w) => [w.issue, w.name]));
  let nextGiven = false;
  const issues = orderChain(listing.issues).map((issue): ChainIssue => {
    const blockers = issue.blockedBy
      .filter((b) => !inChain.has(b.number) && b.state === ISSUE_STATE.open)
      .map((b) => b.number);
    const worker =
      issue.state === ISSUE_STATE.open
        ? (workerOn.get(issue.number) ?? null)
        : null;
    let state: ChainIssueState;
    if (issue.state === ISSUE_STATE.closed) state = CHAIN_ISSUE_STATE.merged;
    else if (worker !== null) state = CHAIN_ISSUE_STATE.inProgress;
    else if (blockers.length > 0) state = CHAIN_ISSUE_STATE.blocked;
    else if (
      !nextGiven &&
      issue.blockedBy.every((b) => b.state === ISSUE_STATE.closed)
    ) {
      state = CHAIN_ISSUE_STATE.next;
      nextGiven = true;
    } else state = CHAIN_ISSUE_STATE.waiting;
    return { issue: issue.number, title: issue.title, state, worker, blockers };
  });
  return { ...source, issues, unknown: null };
}

/** Asks for one plan's listing. */
export type ChainLister = (plan: string) => Promise<ChainListing>;

/**
 * How long one plan's listing from `gh` is kept: a minute. The stream reads
 * every 2 seconds and `gh` takes about 2 to answer, so asking on every
 * reading would keep a `gh` running for as long as a page is open; a merge
 * shows within the minute instead, which is how long a worker's CI watch
 * takes to notice anything anyway.
 */
export const CHAIN_LISTING_TTL_MS = 60_000;

/**
 * A `ChainLister` that keeps each plan's listing from `gh` for `ttlMs`, a
 * failed one included, so a machine without `gh` does not spawn one every
 * reading. The override file (`CHAIN_ISSUES_FILE_ENV`) is read on every call:
 * it is a local file, and the spec takes it away mid-run.
 */
export function createChainLister({
  env = process.env,
  ttlMs = CHAIN_LISTING_TTL_MS,
  clock = Date.now,
  list = (plan: string) => fetchChainListing(plan, env),
}: {
  env?: Record<string, string | undefined>;
  ttlMs?: number;
  clock?: () => number;
  list?: ChainLister;
} = {}): ChainLister {
  const kept = new Map<
    string,
    { at: number; listing: Promise<ChainListing> }
  >();
  return (plan) => {
    if (env[CHAIN_ISSUES_FILE_ENV]?.trim()) return list(plan);
    const now = clock();
    const before = kept.get(plan);
    if (before && now - before.at <= ttlMs) return before.listing;
    const listing = list(plan);
    kept.set(plan, { at: now, listing });
    return listing;
  };
}
