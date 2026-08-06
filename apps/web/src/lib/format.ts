import { DASHBOARD_BUCKET, type DashboardBucket } from "@ticket/shared";

/** What a stat shows when the metric genuinely has no value (an empty slice). */
export const EMPTY_VALUE = "—";

/**
 * A duration in hours, at the precision a human would actually say it in.
 *
 * Sub-hour latencies matter most and read badly as "0.4h", so they become
 * minutes; past a couple of days the hour is noise, so it becomes days.
 */
export function formatHours(hours: number | null): string {
  if (hours === null || !Number.isFinite(hours)) return EMPTY_VALUE;
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)}h`;
  const days = hours / 24;
  return `${days < 10 ? days.toFixed(1) : Math.round(days)}d`;
}

/** Thousands compacted, so a KPI tile can't be widened by one busy quarter. */
export function formatCompact(value: number): string {
  return value >= 10_000
    ? `${(value / 1000).toFixed(value >= 100_000 ? 0 : 1)}k`
    : String(value);
}

export function formatPercent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** A signed delta, so "+4" and "−4" are visually distinct from a plain count. */
export function formatDelta(delta: number): string {
  if (delta === 0) return "±0";
  return delta > 0 ? `+${formatCompact(delta)}` : `−${formatCompact(-delta)}`;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * An axis label for a `YYYY-MM-DD` bucket start.
 *
 * Parsed by splitting the string rather than by `new Date(iso)`, and this is
 * load-bearing: the API truncates buckets in UTC, and
 * `new Date("2026-08-03T00:00:00Z").toLocaleDateString()` renders as Aug 2
 * anywhere west of Greenwich — every bucket would be labelled a day early for
 * half the world. Splitting keeps the calendar date the server meant.
 */
export function formatBucketLabel(
  bucketStart: string,
  bucket: DashboardBucket,
): string {
  const [year, month, day] = bucketStart.split("-").map(Number);
  if (!year || !month || !day) return bucketStart;
  const monthLabel = MONTHS[month - 1] ?? "";
  return bucket === DASHBOARD_BUCKET.month
    ? `${monthLabel} ${String(year).slice(2)}`
    : `${monthLabel} ${day}`;
}

/** The same date spelled out, for a tooltip where there is room for the year. */
export function formatBucketFull(
  bucketStart: string,
  bucket: DashboardBucket,
): string {
  const [year, month, day] = bucketStart.split("-").map(Number);
  if (!year || !month || !day) return bucketStart;
  const monthLabel = MONTHS[month - 1] ?? "";
  if (bucket === DASHBOARD_BUCKET.month) return `${monthLabel} ${year}`;
  const date = `${monthLabel} ${day}, ${year}`;
  return bucket === DASHBOARD_BUCKET.week ? `Week of ${date}` : date;
}

/**
 * How long ago an instant was, coarsely. Used for "silent for 6d" on the
 * needs-attention list, where the exact hour is not the point.
 */
export function formatSince(iso: string, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return EMPTY_VALUE;
  return formatHours(ms / 3_600_000);
}
