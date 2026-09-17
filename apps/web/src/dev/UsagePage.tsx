import { AlertTriangle, Loader2, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { TableFrame } from "@/lib/table-frame";
import { extractErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { useUsageScan } from "./dev-api";
import type { IssueUsage, UsageReport } from "./protocol";

/**
 * What each issue actually cost, read off this machine's Claude Code
 * transcripts.
 *
 * The third dev tool, and the only one that gathers nothing on arrival. The map
 * scans on load because a scan of the source tree is ~110ms and describes
 * something you are looking at anyway; this reads every transcript the machine
 * holds, which on a long-lived project is tens of thousands of JSONL lines. So
 * the page opens empty and says so, and the figures on screen are always one
 * named moment's reading rather than "whatever the machine has been doing"
 * (R5). Pressing Scan again re-reads — `UsageReport` in `./protocol` is where
 * the reason nothing on either side of the wire caches the answer is written
 * down.
 *
 * **Actuals only, for now.** No titles, no links out, no forecast band and no
 * verdict: all four need `gh`, which slice 2 of
 * `docs/plans/dev-tools-usage-page.md` adds to the middleware. Issues with a
 * forecast and no recorded work are absent for the same reason — the row set
 * here is "branches that spent something", not "issues".
 *
 * Output tokens are the column this exists for; cache-read sits beside it and
 * is deliberately not comparable to a forecast band. `apps/web/dev/usage.ts`
 * carries the measurements behind both.
 */

const SCAN_FAILED = "The dev middleware could not read the transcripts.";

/**
 * A whole number, grouped for reading.
 *
 * The terminal table rounds (`120k`) because it is budgeting column widths; this
 * page has room, and the PRD's complaint about the CLI is that the numbers are
 * hard to read rather than that they are too precise. The locale is pinned
 * rather than left to the machine, so the figure a test asserts is the figure
 * every developer sees.
 */
const formatNumber = (n: number): string => n.toLocaleString("en-US");

/**
 * One numeric column, and what it reads off a row.
 *
 * The accessor is what lets this one list drive the header *and* the body. As
 * two parallel literals — a column array for the `<thead>` and four
 * hand-written cells beneath it — adding or reordering a column is two edits
 * that can silently disagree about order or alignment, which is the shape of
 * bug a table ships quietly.
 *
 * The issue number is deliberately not in here: it is the row's identity rather
 * than one of its figures, and it is marked up as a header cell on both axes.
 */
interface Figure {
  label: string;
  /** What the column means, on hover. */
  title: string;
  value: (row: IssueUsage) => number;
  /** The column this page exists for. */
  lead?: boolean;
  /** Muted — the figure that is not comparable to a forecast band. */
  muted?: boolean;
}

const FIGURES: Figure[] = [
  {
    label: "Output tokens",
    title:
      "Actual output tokens — the unit the forecast bands are denominated in",
    value: (row) => row.out,
    lead: true,
  },
  {
    label: "Turns",
    title: "Assistant turns recorded against this issue's branches",
    value: (row) => row.turns,
  },
  {
    label: "Sessions",
    title: "Distinct sittings the work was split across",
    value: (row) => row.sessions,
  },
  {
    label: "Cache read",
    title:
      "Cache-read tokens — a measure of session hygiene, never part of the forecast",
    value: (row) => row.cacheRead,
    muted: true,
  },
];

export function UsagePage() {
  const scan = useUsageScan();
  const report = scan.data ?? null;
  const problem = scan.error
    ? extractErrorMessage(scan.error, SCAN_FAILED)
    : null;

  // The toast is `frontend.md`'s rule for a failed mutation, and this is the
  // first one under `/__dev`. Fired from the call rather than from a render, so
  // a re-render of an already-failed page does not announce it again.
  const runScan = () =>
    scan.mutate(undefined, {
      onError: (err) => toast.error(extractErrorMessage(err, SCAN_FAILED)),
    });

  return (
    /* Block layout with `space-y`, for the reason spelled out on
     * `TestRunnerPage`: as a flex column, a child that is its own scroll
     * container resolves `min-height: auto` to zero and gets crushed. */
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Usage</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            What each issue actually cost, in output tokens, read off this
            machine&rsquo;s Claude Code transcripts. Nothing is read until you
            press Scan.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">dev only</Badge>
          <Button onClick={runScan} disabled={scan.isPending}>
            {scan.isPending ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : (
              <Search aria-hidden="true" />
            )}
            Scan
          </Button>
        </div>
      </div>

      {/* The page's one-line answer, and its only live region. */}
      <p
        aria-live="polite"
        className="rounded-lg bg-card px-3 py-2 text-sm ring-1 ring-border"
      >
        {scan.isPending ? (
          <span className="text-muted-foreground">Reading transcripts…</span>
        ) : report ? (
          <Gathered report={report} />
        ) : (
          <span className="text-muted-foreground">
            Nothing gathered yet. Press Scan to read this machine&rsquo;s
            transcripts.
          </span>
        )}
      </p>

      {/* Inline as well as in the toast: a toast is gone in seconds, and this is
          the copy you are still looking at while you fix the cause. */}
      {problem && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {problem}
        </p>
      )}

      {/* What the scan could not see, shown rather than swallowed — the same
          bargain the project map makes with its own `warnings`. */}
      {report?.warnings.map((warning) => (
        <p
          key={warning}
          className="flex items-start gap-2 rounded-md px-3 py-2 text-sm text-status-warning ring-1 ring-status-warning/30"
        >
          <AlertTriangle
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0"
          />
          {warning}
        </p>
      ))}

      {report && <SpendTable issues={report.issues} />}

      <p className="max-w-prose text-xs text-muted-foreground">
        The same join <code className="font-mono">bun run tokens</code> prints,
        served by the Vite dev plugin out of{" "}
        <code className="font-mono">apps/web/dev/usage.ts</code> — so the
        terminal and this page cannot disagree about what an issue cost. Work
        that ran on <code className="font-mono">main</code> or on no branch
        belongs to no issue and is not shown here, and neither is work done on
        any other machine: these transcripts are local.
      </p>
    </div>
  );
}

/**
 * When this reading was taken, and what it was taken from.
 *
 * The directory is on screen rather than implied, and that is not padding: it is
 * the only thing separating "this machine has done no work" from "the
 * `CLAUDE_TRANSCRIPT_DIR` override is pointed somewhere else", and it is what a
 * failing E2E gets to name instead of reporting a missing row.
 *
 * The timestamp is rendered in the viewer's locale inside a `<time>` carrying
 * the ISO stamp, so the machine-readable value survives the formatting.
 */
function Gathered({ report }: { report: UsageReport }) {
  return (
    <>
      Gathered at{" "}
      <time dateTime={report.gatheredAt} className="font-medium">
        {new Date(report.gatheredAt).toLocaleTimeString()}
      </time>{" "}
      from <code className="font-mono text-xs">{report.transcriptDir}</code> —{" "}
      {report.transcripts}{" "}
      {report.transcripts === 1 ? "transcript" : "transcripts"},{" "}
      {report.issues.length} {report.issues.length === 1 ? "issue" : "issues"},
      read in {report.scanMs} ms.
    </>
  );
}

/**
 * Every issue with recorded spend, biggest first.
 *
 * A plain `<table>` rather than a component, matching `ModuleTable` and
 * `TicketsTable` — this repo has no shadcn table, and a table is markup, not a
 * control. The frame around it is `TableFrame`, which is what makes the
 * scroller focusable and gives it a name (#111); the height cap is what gives it
 * something to scroll and the sticky header something to stick to.
 *
 * The ranking is the server's: rows arrive in output-token order with the issue
 * number as a tie-break, so two scans of an unchanged directory agree. That is a
 * claim about *this* page and not about the terminal — `bun run tokens` sorts on
 * `out` alone, so two issues that spent exactly the same fall out in whatever
 * order the filesystem handed the files over, and the two can rank them
 * differently. R8 is about the figures, which are one module's and do agree;
 * giving the CLI the same tie-break belongs with the rest of slice 6's pass over
 * that script, not here.
 *
 * Sortable headers belong here eventually — `ModuleTable` next door is the shape
 * to copy — but not while there is one column anybody ranks by.
 */
function SpendTable({ issues }: { issues: IssueUsage[] }) {
  if (issues.length === 0) {
    return (
      <TableFrame label="Issue spend" className="grid place-items-center p-6">
        <p className="max-w-prose text-center text-sm text-muted-foreground">
          No issue spend in these transcripts. Only a branch named{" "}
          <code className="font-mono">{"<type>/<issue>-<slug>"}</code> can be
          attributed to an issue.
        </p>
      </TableFrame>
    );
  }

  return (
    <TableFrame label="Issue spend" className="max-h-[70dvh]">
      <table className="w-full text-sm">
        <thead className="text-muted-foreground">
          <tr>
            <th
              scope="col"
              title="GitHub issue number, taken from the branch name"
              className="sticky top-0 z-10 bg-muted px-3 py-2 text-left font-medium"
            >
              Issue
            </th>
            {FIGURES.map((figure) => (
              <th
                key={figure.label}
                scope="col"
                title={figure.title}
                className="sticky top-0 z-10 bg-muted px-3 py-2 text-right font-medium"
              >
                {figure.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {issues.map((row) => (
            <tr key={row.issue} className="border-t border-border">
              {/* A row header, not a cell: the issue number is what every
                  figure on the row is about, so a screen reader announcing a
                  cell announces which issue it belongs to. */}
              <th
                scope="row"
                className="px-3 py-1.5 text-left font-mono font-normal tabular-nums"
              >
                #{row.issue}
              </th>
              {FIGURES.map((figure) => (
                <td
                  key={figure.label}
                  className={cn(
                    "px-3 py-1.5 text-right tabular-nums",
                    figure.lead && "font-medium",
                    figure.muted && "text-muted-foreground",
                  )}
                >
                  {formatNumber(figure.value(row))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </TableFrame>
  );
}
