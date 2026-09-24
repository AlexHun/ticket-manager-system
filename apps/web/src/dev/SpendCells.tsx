import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Hint } from "@/components/Hint";
import { formatTokens } from "./usage-charts";
import {
  BUCKETS,
  VERDICT,
  type Bucket,
  type IssueSpend,
  type IssueUsage,
  type Verdict,
} from "./usage-protocol";
import { hasRecordedSpend } from "./usage-readings";

/**
 * What goes inside a Usage table cell: the two absence markers, a band, a
 * figure, and the comparison cell that reads a forecast against an actual.
 *
 * Out of `SpendTable.tsx` since #297, and not for size alone. These are the
 * parts that carry the page's central distinction — an absence is never a zero
 * — and a reader checking that claim should find every place it is *rendered*
 * on one screen, beside the predicate it asks (`hasRecordedSpend`). The
 * column record that places them is `./SpendColumns`; the table that walks it
 * is `./SpendTable`.
 *
 * **Two sources per row, and the cells never let them be confused.** The
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
export const Unknown = () => (
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
 *
 * The branch itself is `hasRecordedSpend` in `./usage-readings` rather than a
 * truthiness test of this file's own (#285): the same predicate the comparator
 * sinks by, the facet filters by and the distribution samples by, so a cell can
 * never dash a row the chart counted.
 */
export const figure =
  (pick: (spend: IssueSpend) => number) =>
  (row: IssueUsage): ReactNode =>
    hasRecordedSpend(row) ? formatTokens(pick(row.spend)) : <NotStarted />;

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
 * The arrow is `aria-hidden`, so the cell reads out as its two bands and the
 * verdict with nothing between them. The column header carries the direction in
 * words — forecast first, landed second — which is what a reader who cannot see
 * the arrow has to go on, and is why that hint names both halves in order
 * rather than calling the column a comparison and stopping.
 */
export const Comparison = ({ row }: { row: IssueUsage }) => (
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
