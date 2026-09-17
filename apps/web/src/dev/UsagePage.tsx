import type { ReactNode } from "react";
import { AlertTriangle, ExternalLink, Loader2, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { Hint } from "@/components/Hint";
import { TableFrame } from "@/lib/table-frame";
import { extractErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { useUsageScan } from "./dev-api";
import {
  BUCKETS,
  USAGE_COLUMNS,
  VERDICT,
  type Bucket,
  type IssueUsage,
  type UsageColumn,
  type UsageReport,
  type Verdict,
} from "./protocol";

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
 * **Two sources per row, and the page never lets them be confused.** The
 * figures are read off the filesystem and are always there; the title, the link
 * and the forecast band come from `gh` and may not be. Anything `gh` could not
 * supply renders as an em dash meaning *unknown* — never a zero, never a
 * default band, and never a verdict, because a verdict on work nobody forecast
 * is a score invented by the page. With `gh` missing or unauthenticated every
 * figure still lands and only those columns go quiet, which is the state CI is
 * in by default.
 *
 * Output tokens are the column this exists for; cache-read sits beside it and
 * is deliberately not comparable to a forecast band. `apps/web/dev/usage.ts`
 * carries the measurements behind both.
 *
 * Still absent, per slice 3 of `docs/plans/dev-tools-usage-page.md`: issues
 * with a forecast and no recorded work. The row set here is "branches that
 * spent something", not "issues".
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
 * Stands in for a value `gh` could not supply.
 *
 * One marker for all three columns that can lack one, because they fail
 * together and mean the same thing: *unknown*. The distinction it protects is
 * the page's only real claim — an empty forecast column is not a forecast of
 * zero, and an empty verdict is not a passing grade. The hint is where that is
 * said in words, since a bare dash is not self-explanatory to anyone who has
 * not read this file.
 */
const Unknown = () => (
  <Hint content="Unknown — gh could not supply this">
    <span className="text-muted-foreground">&mdash;</span>
  </Hint>
);

/** A band, as its letter and the range that letter means. Both, because the
 *  letter alone is jargon and the range alone does not match the label on the
 *  issue. */
const Band = ({ band }: { band: Bucket }) => (
  <span className="whitespace-nowrap">
    <span className="font-medium">{band}</span>{" "}
    <span className="text-xs text-muted-foreground">{BUCKETS[band].label}</span>
  </span>
);

/** Colour carries the same three verdicts the word does, and adds nothing: over
 *  is the one worth catching an eye. */
const VERDICT_VARIANT: Record<Verdict, "default" | "outline" | "destructive"> =
  {
    [VERDICT.onTarget]: "default",
    [VERDICT.over]: "destructive",
    [VERDICT.under]: "outline",
  };

/**
 * One column, and what it renders from a row.
 *
 * The renderer is what lets this one list drive the header *and* the body. As
 * two parallel literals — a column array for the `<thead>` and hand-written
 * cells beneath it — adding or reordering a column is two edits that can
 * silently disagree about order or alignment, which is the shape of bug a table
 * ships quietly. It started as a list of numeric accessors and generalised the
 * moment words arrived beside the figures; `numeric` is what still separates
 * the two, and it decides alignment for the header and the cell together.
 *
 * The issue number is deliberately not in here: it is the row's identity rather
 * than one of its columns, and it is marked up as a header cell on both axes.
 */
interface Column {
  label: string;
  /** What the column means, on hover. */
  title: string;
  render: (row: IssueUsage) => ReactNode;
  /** Right-aligned and tabular — a figure rather than a word. */
  numeric?: boolean;
  /** The column this page exists for. */
  lead?: boolean;
  /** Muted — the figure that is not comparable to a forecast band. */
  muted?: boolean;
}

/**
 * What each column renders, keyed by name.
 *
 * The *order* is `USAGE_COLUMNS` in `./protocol` and not this literal's key
 * order, because two tests index a row by position and neither can import this
 * file — so the order has to live somewhere import-free. Keying by the same
 * names is what keeps the two in step: a column defined here and left out of
 * that list does not compile, and neither does the reverse.
 */
const COLUMNS: Record<UsageColumn, Column> = {
  title: {
    label: "Title",
    title: "The issue on GitHub — the link opens it in a new tab",
    render: (row) =>
      row.title === null ? (
        <Unknown />
      ) : row.url === null ? (
        <span className="block max-w-[26rem] truncate">{row.title}</span>
      ) : (
        // The hint carries the untruncated title, which is the one thing the
        // cell cannot show: `max-w` plus `truncate` is what stops a long title
        // widening the table past every figure beside it.
        <Hint content={row.title}>
          <a
            href={row.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex max-w-[26rem] items-center gap-1 underline decoration-dotted underline-offset-4 hover:decoration-solid"
          >
            <span className="truncate">{row.title}</span>
            <ExternalLink aria-hidden="true" className="size-3 shrink-0" />
          </a>
        </Hint>
      ),
  },
  forecast: {
    label: "Forecast",
    title: "The band its forecast/S|M|L label names, applied when it was cut",
    render: (row) =>
      row.forecast ? <Band band={row.forecast} /> : <Unknown />,
  },
  out: {
    label: "Output tokens",
    title:
      "Actual output tokens — the unit the forecast bands are denominated in",
    render: (row) => formatNumber(row.out),
    numeric: true,
    lead: true,
  },
  bucket: {
    label: "Bucket",
    title: "The band the actual spend lands in",
    render: (row) => <Band band={row.bucket} />,
  },
  verdict: {
    label: "Verdict",
    title:
      "The actual read against the forecast — unknown when nothing was forecast",
    render: (row) =>
      row.verdict ? (
        <Badge variant={VERDICT_VARIANT[row.verdict]}>{row.verdict}</Badge>
      ) : (
        <Unknown />
      ),
  },
  turns: {
    label: "Turns",
    title: "Assistant turns recorded against this issue's branches",
    render: (row) => formatNumber(row.turns),
    numeric: true,
  },
  sessions: {
    label: "Sessions",
    title: "Distinct sittings the work was split across",
    render: (row) => formatNumber(row.sessions),
    numeric: true,
  },
  cacheRead: {
    label: "Cache read",
    title:
      "Cache-read tokens — a measure of session hygiene, never part of the forecast",
    render: (row) => formatNumber(row.cacheRead),
    numeric: true,
    muted: true,
  },
};

/** The columns as the table walks them: `USAGE_COLUMNS`'s order, `COLUMNS`'s
 *  definitions. One list for the header and the body both. */
const ORDERED = USAGE_COLUMNS.map((name) => COLUMNS[name]);

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
            What each issue was forecast to cost and what it actually cost, in
            output tokens, read off this machine&rsquo;s Claude Code
            transcripts. Nothing is read until you press Scan.
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
        terminal and this page cannot disagree about what an issue cost or
        whether it came in on target. Titles, links and forecast bands come from{" "}
        <code className="font-mono">gh</code>; without it the figures still land
        and those columns read as unknown. Work that ran on{" "}
        <code className="font-mono">main</code> or on no branch belongs to no
        issue and is not shown here, and neither is work done on any other
        machine: these transcripts are local.
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
 * number as a tie-break, so two scans of an unchanged directory agree — and so
 * does `bun run tokens`, which since slice 2 prints these same rows rather than
 * ordering the scan itself.
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
              className="sticky top-0 z-10 bg-muted px-3 py-2 text-left font-medium"
            >
              <Hint content="GitHub issue number, taken from the branch name">
                <span>Issue</span>
              </Hint>
            </th>
            {ORDERED.map((column) => (
              <th
                key={column.label}
                scope="col"
                className={cn(
                  "sticky top-0 z-10 bg-muted px-3 py-2 font-medium",
                  column.numeric ? "text-right" : "text-left",
                )}
              >
                {/* `ModuleTable` next door puts the hint on the sort button;
                    there is nothing to sort here yet, so it wraps the label. */}
                <Hint content={column.title}>
                  <span>{column.label}</span>
                </Hint>
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
              {ORDERED.map((column) => (
                <td
                  key={column.label}
                  className={cn(
                    "px-3 py-1.5",
                    column.numeric && "text-right tabular-nums",
                    column.lead && "font-medium",
                    column.muted && "text-muted-foreground",
                  )}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </TableFrame>
  );
}
