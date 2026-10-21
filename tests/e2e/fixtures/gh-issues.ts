import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The issue listing `dev-usage.spec.ts` asserts against, and the file the dev
 * server reads it from.
 *
 * The companion to `transcript-fixture.ts`: that one pins what was *spent*,
 * this one pins what was *forecast*. Neither is something a test could assert
 * against for real — a machine's spend is its own, and what this repository's
 * issues are titled changes every time somebody files one.
 *
 * Shared between `playwright.config.ts`, which puts the path in the web
 * server's environment as `GH_ISSUES_FILE`, and the spec, which writes the file
 * and (for the degraded case) takes it away again. It holds exactly what
 * `gh issue list --state all --json number,title,state,url,labels` prints, so
 * the fixture and the real thing go through the same parser in
 * `apps/web/dev/issues.ts`.
 *
 * **Written by the spec rather than checked in**, because the spec has to be
 * able to remove it: `GH_ISSUES_FILE` is set once for the whole run, and the
 * one honest way to reach the no-`gh` state through the real middleware is for
 * the file it names to be missing when Scan is pressed. Generated, so a run
 * that dies mid-way leaves a gitignored artefact rather than a modified fixture.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Gitignored: `.local.json` marks it as generated, next to the fixtures that
 *  are not. */
export const GH_ISSUES_FIXTURE_PATH = path.join(HERE, "gh-issues.local.json");

const issue = (
  number: number,
  title: string,
  labels: string[],
  state: "OPEN" | "CLOSED" = "OPEN",
) => ({
  number,
  title,
  state,
  url: `https://github.com/AlexHun/ticket-manager-system/issues/${number}`,
  labels: labels.map((name) => ({ name })),
});

/**
 * Five issues: the three the transcript fixture spends on, and two it does not.
 *
 * `#101` spent 32,000 output tokens against a `forecast/S` band (<60k), so it
 * is **on target** — the enriched row the spec reads a title, an `href` and a
 * verdict off. `#102` carries no forecast label at all, which is the other case
 * worth holding: it must render with its figures and *no* verdict, rather than
 * a default one.
 *
 * `#105` is the row #274 added and the reason it had to: it spent 90,000
 * against the same `forecast/S` band, so it lands in `M` and its verdict is
 * **over**. Until it existed the fixture had no over-budget row at all, and a
 * verdict facet whose only testable outcome is "matches nothing" proves
 * nothing about a filter. It is also why `CHARTS` in the spec now reads 1/2
 * rather than 1/1 — see `transcripts/README.md`, which carries the arithmetic.
 *
 * The last two have no branch anywhere in the transcripts, and they are the
 * pair #251 turns on. `#103` is **open**, so it earns a row with its band and
 * an empty actual — an issue nobody has started, which the page reports rather
 * than omits. `#104` is **closed** with the same absence of work, and must
 * *not* appear: an issue finished somewhere this scan cannot see (another
 * machine, or before these transcripts began) would otherwise be reported as
 * having cost nothing. Both carry a forecast, so what separates them in the
 * table is their state and nothing else.
 *
 * The titles say "fixture" on purpose. All five numbers are real issues in this
 * repository, so a run that adopted a leftover dev server started without
 * `GH_ISSUES_FILE` would quietly show their real titles instead — and the
 * assertion that fails should say which listing it read, not merely that some
 * text did not match.
 */
export const GH_ISSUES = [
  issue(101, "Fixture: the issue these transcripts spent on", [
    "ready-for-agent",
    "forecast/S",
  ]),
  issue(102, "Fixture: an issue nobody forecast", ["ready-for-agent"]),
  issue(103, "Fixture: an open issue nobody has started", ["forecast/M"]),
  issue(
    104,
    "Fixture: a closed issue with no recorded work",
    ["forecast/L"],
    "CLOSED",
  ),
  issue(105, "Fixture: an issue that came in over its band", [
    "ready-for-agent",
    "forecast/S",
  ]),
];

export function writeGhIssuesFixture(): void {
  mkdirSync(HERE, { recursive: true });
  writeFileSync(
    GH_ISSUES_FIXTURE_PATH,
    JSON.stringify(GH_ISSUES, null, 2),
    "utf8",
  );
}

/** Takes the listing away, so the next Scan reaches the degraded path for real
 *  rather than being handed a report that says it did. */
export function removeGhIssuesFixture(): void {
  rmSync(GH_ISSUES_FIXTURE_PATH, { force: true });
}

/**
 * The issue listing a running chain is ordered by on the Sessions page
 * (#594), and the file the dev server reads it from as `GH_CHAIN_ISSUES_FILE`
 * (`apps/web/dev/issues.ts`). It holds what `listChainIssues`' call prints —
 * `gh issue list --search "<plan>" in:body --json number,title,state,blockedBy`
 * — and is written and removed by the spec for `GH_ISSUES_FIXTURE_PATH`'s
 * reason: a missing file is how a chain whose order is unknown is reached
 * through the real middleware.
 */
export const GH_CHAIN_ISSUES_FIXTURE_PATH = path.join(
  HERE,
  "gh-chain-issues.local.json",
);

const chainIssue = (
  number: number,
  title: string,
  state: "OPEN" | "CLOSED",
  blockedBy: [number, "OPEN" | "CLOSED"][] = [],
) => ({
  number,
  title,
  state,
  blockedBy: {
    nodes: blockedBy.map(([n, s]) => ({ number: n, state: s })),
    totalCount: blockedBy.length,
  },
});

/**
 * Four issues of the conductor fixture's plan, listed out of order. `#201` is
 * closed, so Merged; `#202` and `#203` wait on it alone, so in the chain's
 * order — blockers first, ties by number — `#202`, which the conductor
 * started Flint on, is In progress and `#203` is Next. `#204` waits on
 * `#299`, which is outside the chain and still open, so it is Blocked.
 */
export const GH_CHAIN_ISSUES = [
  chainIssue(204, "Fixture: a chain issue blocked from outside", "OPEN", [
    [299, "OPEN"],
  ]),
  chainIssue(203, "Fixture: the chain's next issue", "OPEN", [[201, "CLOSED"]]),
  chainIssue(202, "Fixture: the chain issue in progress", "OPEN", [
    [201, "CLOSED"],
  ]),
  chainIssue(201, "Fixture: the chain issue already merged", "CLOSED"),
];

export function writeGhChainIssuesFixture(): void {
  mkdirSync(HERE, { recursive: true });
  writeFileSync(
    GH_CHAIN_ISSUES_FIXTURE_PATH,
    JSON.stringify(GH_CHAIN_ISSUES, null, 2),
    "utf8",
  );
}

export function removeGhChainIssuesFixture(): void {
  rmSync(GH_CHAIN_ISSUES_FIXTURE_PATH, { force: true });
}
