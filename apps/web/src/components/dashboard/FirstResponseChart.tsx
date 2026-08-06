import { LATENCY_BUCKET, type FirstResponseStats } from "@ticket/shared";
import { formatHours } from "@/lib/format";
import { BucketChart } from "./BucketChart";
import { LATENCY_LABEL } from "./chart-tokens";

const ORDER = [
  LATENCY_BUCKET.under1h,
  LATENCY_BUCKET.h1to4,
  LATENCY_BUCKET.h4to24,
  LATENCY_BUCKET.over24h,
] as const;

/**
 * How long the first outbound reply took, distributed.
 *
 * The tickets nobody ever answered are **not** a bucket here. They have no
 * latency, so folding them in would either invent a number or quietly drop
 * them — instead they are stated in the footer, next to the median they would
 * otherwise flatter. A median of a few hours across the tickets someone replied
 * to is not a good first-response time if a dozen more were never touched.
 */
export function FirstResponseChart({
  stats,
  className,
}: {
  stats: FirstResponseStats;
  className?: string;
}) {
  return (
    <BucketChart
      className={className}
      title="Time to first reply"
      subtitle="First outbound message, measured from when the ticket arrived"
      binColumn="Within"
      stat={
        <span className="text-sm text-muted-foreground">
          median{" "}
          <span className="font-medium text-foreground tabular-nums">
            {formatHours(stats.medianHours)}
          </span>
          {stats.p90Hours !== null && (
            <>
              {" · p90 "}
              <span className="font-medium text-foreground tabular-nums">
                {formatHours(stats.p90Hours)}
              </span>
            </>
          )}
        </span>
      }
      bins={ORDER.map((bucket) => ({
        label: LATENCY_LABEL[bucket],
        count: stats.buckets[bucket],
      }))}
      footer={
        stats.awaiting > 0
          ? `${stats.awaiting} ticket${stats.awaiting === 1 ? "" : "s"} never answered — not counted above`
          : `All ${stats.responded} tickets in this range were answered.`
      }
      emptyMessage="No replies sent in this range."
    />
  );
}
