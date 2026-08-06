import { AGE_BUCKET, type BacklogAgeStats } from "@ticket/shared";
import { formatHours } from "@/lib/format";
import { BucketChart } from "./BucketChart";
import { AGE_LABEL } from "./chart-tokens";

const ORDER = [
  AGE_BUCKET.under1d,
  AGE_BUCKET.d1to3,
  AGE_BUCKET.d3to7,
  AGE_BUCKET.over7d,
] as const;

/**
 * How old the still-open tickets are.
 *
 * Age is measured from arrival to the moment the response was computed — the
 * same instant every other panel used — so the numbers on this page agree with
 * each other rather than each drifting to its own `now()`.
 */
export function BacklogAgeChart({
  stats,
  className,
}: {
  stats: BacklogAgeStats;
  className?: string;
}) {
  return (
    <BucketChart
      className={className}
      title="Open backlog age"
      subtitle="How long the tickets still open have been waiting"
      binColumn="Age"
      stat={
        <span className="text-sm text-muted-foreground">
          median{" "}
          <span className="font-medium text-foreground tabular-nums">
            {formatHours(stats.medianAgeHours)}
          </span>
        </span>
      }
      bins={ORDER.map((bucket) => ({
        label: AGE_LABEL[bucket],
        count: stats.buckets[bucket],
      }))}
      emptyMessage="Nothing open in this range."
    />
  );
}
