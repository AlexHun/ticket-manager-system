import { useId, useState } from "react";
import { AlertTriangle, Loader2, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { extractErrorMessage } from "@/lib/errors";
import { useUsageScan } from "./dev-api";
import {
  DEFAULT_USAGE_TABLE_VIEW,
  SpendTable,
  type UsageTableView,
} from "./SpendTable";
import { UsageCharts } from "./UsageCharts";
import { formatTokens } from "./usage-charts";
import type { UnattributedWork, UsageReport } from "./usage-protocol";

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
 * (R5). Pressing Scan again re-reads — `UsageReport` in `./usage-protocol` is
 * where the reason nothing on either side of the wire caches the answer is
 * written down.
 *
 * **The rows are `./SpendTable`, which is where everything about an issue
 * lives** (#270) — the column definitions, the two markers that tell a missing
 * forecast from unstarted work, and the merged forecast-versus-actual cell. The
 * page keeps what describes the *reading* rather than a row: when it was taken,
 * what was read, and the work that belongs to no issue at all.
 *
 * Output tokens are the column this exists for; cache-read sits beside it and
 * is deliberately not comparable to a forecast band. `apps/web/dev/usage.ts`
 * carries the measurements behind both.
 *
 * **Two charts sit above the table** (#252), answering the questions it
 * otherwise makes you compute by eye: how often a forecast band matched, and
 * whether the bands still fit the work. They read the same rows and are derived
 * in `./usage-charts.ts`; what they refuse to read is the subject of that file.
 *
 * **A row is not proof that work happened** (#251). Every open issue gets one,
 * so the page answers "what is this forecast to cost?" before the work as well
 * as after it, and a missing `forecast/S|M|L` label is a row you can see rather
 * than an absence you have to know to look for. Those rows carry no figures at
 * all, which is a third thing an em dash can mean here — see `NotStarted` in
 * `./SpendTable`.
 *
 * **And below the table, the work that is in none of it** (#253). Turns that ran
 * on `main` or on no branch belong to no issue, and they are a large share of
 * everything this machine has done — so a page that listed only issues would
 * read as complete while omitting a quarter of the work. It is a total rather
 * than a row, for the reason `Unattributed` gives below.
 */

const SCAN_FAILED = "The dev middleware could not read the transcripts.";

export function UsagePage() {
  const scan = useUsageScan();
  const report = scan.data ?? null;
  /* How the table below is being read — its ranking, whether the detail
     columns are shown, and what the four controls on its bar have narrowed it
     to. It belongs to the table and is held here for one
     measured reason: `useUsageScan` is a `useMutation`, and a mutation clears
     its `data` the moment it is fired — so `report` is null for the length of
     the read, the gate below closes, and `SpendTable` unmounts with whatever
     state it was holding. Kept inside it, both would be thrown away by the
     press of Scan that re-asks the same question — and a sort that came back
     without the column announcing it would be worse than either alone. The
     rows change; how the developer is reading them does not. */
  const [view, setView] = useState<UsageTableView>(DEFAULT_USAGE_TABLE_VIEW);
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

      {/* Above the table, not below it: the charts are the page's answer and
          the table is the evidence for it — and the table is also the charts'
          accessibility-relief path, which reads better after the thing it
          relieves. Both are gated on the same `report`, so nothing survives
          into the next press. */}
      {report && <UsageCharts issues={report.issues} />}

      {report && (
        <SpendTable issues={report.issues} view={view} onViewChange={setView} />
      )}

      {/* Below the table rather than inside it: the same reading, and the one
          part of it that is not an issue. */}
      {report && <Unattributed work={report.unattributed} />}

      <p className="max-w-prose text-xs text-muted-foreground">
        The same join <code className="font-mono">bun run tokens</code> prints,
        served by the Vite dev plugin out of{" "}
        <code className="font-mono">apps/web/dev/usage.ts</code> — so the
        terminal and this page cannot disagree about what an issue cost or
        whether it came in on target. Titles, links and forecast bands come from{" "}
        <code className="font-mono">gh</code>; without it the figures still land
        and only those read as unknown. Every open issue is listed, so an issue
        nobody has started appears with its band and no figures rather than not
        at all. Work that ran on <code className="font-mono">main</code> or on
        no branch belongs to no issue and is totalled on its own below the
        table. Two things are in neither place: work done on any other machine,
        since these transcripts are local, and a branch whose name carries no
        issue number, which the join has nothing to attribute and does not call
        unattributed either.
      </p>
    </div>
  );
}

/**
 * What ran on `main`, or on no branch at all — the work that is in none of the
 * rows above.
 *
 * **A total, deliberately not a row** (#253), and the acceptance criterion is
 * the design. A row is the obvious place for it and the one place it cannot go:
 * it has no issue number to be identified by, no title and no link, nothing
 * forecast it, and `bucketFor` would file its tokens in a band as though
 * somebody had — which the distribution would then count and the accuracy figure
 * would score. Sitting outside the table, it competes with nothing and reads as
 * what it is.
 *
 * **Both figures, because the turns alone were the bug.** The join counted these
 * turns and threw their output tokens away, so the page could say how much work
 * happened here and never what it cost — and a total that omits a quarter of the
 * spend reads as complete when it is not.
 *
 * **Zero is rendered here, where a row would render an em dash.** That is not
 * an exception to `NotStarted` so much as the other side of it: a row's figures
 * are dashed because `bucketFor(0)` is `S`, so a zero there gets banded, scored
 * and counted in the quartiles. Nothing scores these two, so there is no score
 * for a zero to invent — and a panel that vanished on one would read as the page
 * not asking rather than as an answer.
 *
 * The strip is deliberately the same `bg-card` / `ring-border` shape as the
 * "Gathered at" line at the top: both are one reading's own words about itself,
 * neither is a row, and looking alike is what says so.
 */
function Unattributed({ work }: { work: UnattributedWork }) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className="rounded-lg bg-card px-3 py-2 ring-1 ring-border"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        {/* Not an `<h2>`, matching `ChartPanel`'s `CardTitle` next door, which
            is a `div`. A heading here would be the only one on the page below
            the `<h1>` — putting the smallest panel alone in the document
            outline and implying it outranks the two charts. `aria-labelledby`
            names the region either way. */}
        <p id={titleId} className="text-sm font-medium">
          Unattributed work
        </p>
        <p className="text-sm">
          <Quantity
            value={work.turns}
            unit={work.turns === 1 ? "turn" : "turns"}
          />
          <span aria-hidden="true" className="px-2 text-muted-foreground">
            &middot;
          </span>
          <Quantity value={work.out} unit="output tokens" />
        </p>
      </div>
      <p className="max-w-prose pt-1 text-xs text-muted-foreground">
        Turns that ran on <code className="font-mono">main</code> or on no
        branch at all. They belong to no issue, so nothing above includes them
        &mdash; and they are a total rather than a row because there is no issue
        number to carry, nothing forecast them, and no band for them to land in.
      </p>
    </section>
  );
}

/** A figure and the unit it is in, kept in one element so the two cannot wrap
 *  apart — a lone "turns" on the next line names nothing. Named away from the
 *  `figure` helper in `./SpendTable`, which is a cell renderer and unrelated. */
const Quantity = ({ value, unit }: { value: number; unit: string }) => (
  <span className="whitespace-nowrap">
    <span className="font-medium tabular-nums">{formatTokens(value)}</span>{" "}
    <span className="text-muted-foreground">{unit}</span>
  </span>
);

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
