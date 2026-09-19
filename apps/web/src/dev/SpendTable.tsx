import { type ReactNode } from "react";
import { ArrowRight, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Hint } from "@/components/Hint";
import { TableFrame } from "@/lib/table-frame";
import { cn } from "@/lib/utils";
import { formatTokens } from "./usage-charts";
import {
  BUCKETS,
  USAGE_COLUMNS,
  VERDICT,
  type Bucket,
  type IssueSpend,
  type IssueUsage,
  type UsageColumn,
  type Verdict,
} from "./protocol";

/**
 * The Usage page's spend table, and the definitions of every column in it.
 *
 * Lifted out of `UsagePage.tsx` whole (#270), which had grown to hold the page,
 * this table, the column record and four small components at once — and is the
 * file each of the four tickets after this one edits. Nothing about the page
 * changed in the move; what the page keeps is the parts that describe a
 * *reading* rather than a row (`Gathered`, `Unattributed`), and what came here
 * is everything that renders an issue.
 *
 * **Two sources per row, and the table never lets them be confused.** The
 * figures are read off the filesystem; the title, the link and the forecast
 * band come from `gh`, which may be absent. Anything `gh` could not supply
 * renders as an em dash meaning *unknown* — never a zero, never a default band,
 * and never a verdict, because a verdict on work nobody forecast is a score
 * invented by the page. With `gh` missing or unauthenticated every figure a row
 * has still lands and only those parts go quiet, which is the state CI is in by
 * default.
 */

/**
 * Stands in for a value `gh` could not supply.
 *
 * One marker for everything that can lack one for this reason, because they
 * fail together and mean the same thing: *unknown*. The distinction it protects
 * is the page's only real claim — an empty forecast is not a forecast of zero,
 * and an empty verdict is not a passing grade. The hint is where that is said
 * in words, since a bare dash is not self-explanatory to anyone who has not
 * read this file.
 */
const Unknown = () => (
  <Hint content="Unknown — gh could not supply this">
    <span className="text-muted-foreground">&mdash;</span>
  </Hint>
);

/**
 * Stands in for a figure there is no work to report.
 *
 * The same dash as `Unknown` above and deliberately a different component,
 * because it is a different claim: `Unknown` means the question could not be
 * asked, this means it was asked and the answer is *nothing yet*. The
 * transcripts were read and they name no branch for this issue.
 *
 * What it must never be is a zero. `bucketFor(0)` is `S` and a forecast of `L`
 * read against it is "under", so an unstarted issue rendered as zeroes would
 * sit in the table claiming to have come in comfortably under budget — and
 * would take the accuracy figure and the percentile distribution down with it.
 * The two markers are told apart on hover rather than by sight, which is enough
 * because the *pattern* of dashes already differs: a `gh` that failed leaves the
 * figures standing, an issue nobody has started leaves only its title.
 */
const NotStarted = () => (
  <Hint content="No recorded work — these transcripts name no branch for this issue">
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

/**
 * A numeric cell, from the figure it reads off a row's spend.
 *
 * One definition rather than four, because the branch is the same one every
 * time and it is the branch that carries this slice's rule: a row with no spend
 * has no figures, and each of the four is absent exactly when the others are —
 * which is why `IssueSpend` is one nullable object on the wire rather than four
 * nullable numbers.
 */
const figure =
  (pick: (spend: IssueSpend) => number) =>
  (row: IssueUsage): ReactNode =>
    row.spend ? formatTokens(pick(row.spend)) : <NotStarted />;

/** Colour carries the same three verdicts the word does, and adds nothing: over
 *  is the one worth catching an eye. */
const VERDICT_VARIANT: Record<Verdict, "default" | "outline" | "destructive"> =
  {
    [VERDICT.onTarget]: "default",
    [VERDICT.over]: "destructive",
    [VERDICT.under]: "outline",
  };

/**
 * The band aimed at, the band landed in, and the word comparing them — in one
 * cell (#270).
 *
 * Three columns until this slice, which spelled the comparison out across the
 * width of the table and made it the reason nobody could read the table without
 * scrolling sideways. As a sentence — `M 60-150k → S <60k` and then the verdict
 * — it is the same three facts in the order they are actually read, and the
 * arrow is what says which way round they go.
 *
 * **The merge must not cost the distinction the page is built on.** Two
 * different absences live here and they are not the same claim: the left half
 * is `Unknown` when `gh` could not supply a band (no listing, unauthenticated,
 * or the issue carries no `forecast/S|M|L` label), and the right half is
 * `NotStarted` when the transcripts name no branch for the issue. They are the
 * same em dash and different words on hover, which is enough because the
 * *pattern* differs: a `gh` that failed leaves the landed band and every figure
 * standing, an issue nobody has started leaves only its title and its band.
 * Neither may ever be substituted by a zero or by a default band — `bucketFor(0)`
 * is `S`, so an unstarted row shown as zeroes would claim to have come in under
 * an `L` forecast, and would drag the accuracy figure and the quartiles with it.
 *
 * The verdict is simply absent whenever either half is, because `verdict` on
 * the wire is null unless both are known. There is nothing to add for the
 * absence: the half that is dashed already says which question went unanswered,
 * and a third marker after it would be the same sentence twice.
 *
 * The arrow is `aria-hidden` and the cell reads out as its two bands and the
 * verdict; the column header's hint is where the direction is said in words.
 */
const Comparison = ({ row }: { row: IssueUsage }) => (
  <span className="flex items-center gap-2">
    {row.forecast ? <Band band={row.forecast} /> : <Unknown />}
    <ArrowRight
      aria-hidden="true"
      className="size-3 shrink-0 text-muted-foreground"
    />
    {row.bucket ? <Band band={row.bucket} /> : <NotStarted />}
    {row.verdict && (
      <Badge variant={VERDICT_VARIANT[row.verdict]}>{row.verdict}</Badge>
    )}
  </span>
);

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
  out: {
    label: "Output tokens",
    title:
      "Actual output tokens — the unit the forecast bands are denominated in",
    render: figure((spend) => spend.out),
    numeric: true,
    lead: true,
  },
  comparison: {
    label: "Forecast vs actual",
    title:
      "The band its forecast/S|M|L label named, the band its actual spend landed in, and the two read against each other — nothing to score until an issue has both",
    render: (row) => <Comparison row={row} />,
  },
  turns: {
    label: "Turns",
    title: "Assistant turns recorded against this issue's branches",
    render: figure((spend) => spend.turns),
    numeric: true,
  },
  sessions: {
    label: "Sessions",
    title: "Distinct sittings the work was split across",
    render: figure((spend) => spend.sessions),
    numeric: true,
  },
  cacheRead: {
    label: "Cache read",
    title:
      "Cache-read tokens — a measure of session hygiene, never part of the forecast",
    render: figure((spend) => spend.cacheRead),
    numeric: true,
    muted: true,
  },
};

/** The columns as the table walks them: `USAGE_COLUMNS`'s order, `COLUMNS`'s
 *  definitions. One list for the header and the body both. */
const ORDERED = USAGE_COLUMNS.map((name) => COLUMNS[name]);

/**
 * Every issue worth looking at, biggest spend first — and, after them, the open
 * issues nobody has started, which carry a forecast and no figures at all.
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
 * ordering the scan itself. The unstarted issues are a block at the end rather
 * than rows sorted at zero, because an empty actual is not a small one and
 * filing them among the cheapest issues is where they would read as work that
 * cost almost nothing.
 *
 * Sortable headers belong here eventually — `ModuleTable` next door is the shape
 * to copy — but not while there is one column anybody ranks by.
 */
export function SpendTable({ issues }: { issues: IssueUsage[] }) {
  if (issues.length === 0) {
    return (
      <TableFrame label="Issue spend" className="grid place-items-center p-6">
        <p className="max-w-prose text-center text-sm text-muted-foreground">
          No issue spend in these transcripts, and no open issue to list beside
          it. Only a branch named{" "}
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
