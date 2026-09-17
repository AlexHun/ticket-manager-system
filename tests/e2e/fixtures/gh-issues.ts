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
 * Four issues: the two the transcript fixture spends on, and two it does not.
 *
 * `#101` spent 20,000 output tokens against a `forecast/S` band (<60k), so it
 * is **on target** — the enriched row the spec reads a title, an `href` and a
 * verdict off. `#102` carries no forecast label at all, which is the other case
 * worth holding: it must render with its figures and *no* verdict, rather than
 * a default one.
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
 * The titles say "fixture" on purpose. All four numbers are real issues in this
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
