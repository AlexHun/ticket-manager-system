import {
  BACKLOG_STATUS,
  type FirstResponseStats,
  type TicketStatsSummary,
} from "@ticket/shared";
import { KPI_STATUS, type KpiStatus } from "./StatusPill";

/**
 * Where each KPI turns from fine to worth-looking-at.
 *
 * These are judgement calls, not derived constants, so they live together in one
 * named place rather than inline at four call sites — a threshold buried in JSX
 * is a threshold nobody re-tunes. Written as the numbers a support lead would
 * actually argue about, so arguing about them means editing this block.
 *
 * They are deliberately *not* configurable per user. A dashboard where everyone
 * sets their own definition of "bad" stops being comparable between people, and
 * this product already has one shared queue.
 */
export const KPI_THRESHOLD = {
  /** Share of the slice still open. Above `criticalOpenShare` the queue is
   *  underwater rather than merely busy. */
  warnOpenShare: 0.5,
  criticalOpenShare: 0.7,
  /** Any unowned ticket is a warning; this many is a failure of triage. */
  criticalUnassigned: 10,
  /** Hours to first reply. 8h is one working day of silence. */
  warnFirstReplyHours: 8,
  criticalFirstReplyHours: 24,
  /** Share resolved or closed. Above this the slice is genuinely in good shape. */
  goodSettledShare: 0.7,
} as const;

export interface KpiVerdict {
  status: KpiStatus;
  label: string;
}

/**
 * Open backlog.
 *
 * Judged as a *share* of the slice, not a raw count: 25 open out of 30 is a
 * problem and 25 out of 500 is a Tuesday, and a fixed count would call both the
 * same thing. Unassigned is folded in here rather than given its own tile
 * because "nobody owns it" is the actionable part of "it is open".
 */
export function openVerdict(summary: TicketStatsSummary): KpiVerdict | null {
  // New counts as backlog, and this is the line where forgetting that would do
  // the most damage: on a deployment with no AI key every ticket sits in New,
  // and a verdict scoped to Open alone would report a healthy queue in front of
  // an untouched inbox. `Processing` is excluded — a worker is on it.
  const open = BACKLOG_STATUS.reduce(
    (sum, status) => sum + summary.byStatus[status],
    0,
  );
  if (summary.total === 0 || open === 0) return null;
  const share = open / summary.total;

  if (
    share >= KPI_THRESHOLD.criticalOpenShare ||
    summary.openUnassigned >= KPI_THRESHOLD.criticalUnassigned
  ) {
    return { status: KPI_STATUS.critical, label: "Backlog high" };
  }
  if (share >= KPI_THRESHOLD.warnOpenShare || summary.openUnassigned > 0) {
    return { status: KPI_STATUS.warning, label: "Needs triage" };
  }
  return null;
}

/**
 * Settled share — the one tile that can say "well done".
 *
 * Only ever good or silent. There is no "settled share is too low" warning here
 * because that is the same fact as the open backlog next to it, and flagging one
 * number twice makes a busy queue look like two separate problems.
 */
export function settledVerdict(summary: TicketStatsSummary): KpiVerdict | null {
  if (summary.total === 0) return null;
  return summary.settledShare >= KPI_THRESHOLD.goodSettledShare
    ? { status: KPI_STATUS.good, label: "On track" }
    : null;
}

/**
 * Time to first reply.
 *
 * A ticket that has never been answered outranks the median: the median can look
 * healthy while somebody has been waiting since last week, so `awaiting` is
 * checked first and reported in its own words.
 */
export function firstReplyVerdict(
  stats: FirstResponseStats,
): KpiVerdict | null {
  if (stats.awaiting > 0) {
    return {
      status:
        stats.awaiting >= KPI_THRESHOLD.criticalUnassigned
          ? KPI_STATUS.critical
          : KPI_STATUS.warning,
      label: "Unanswered",
    };
  }
  const median = stats.medianHours;
  if (median === null) return null;
  if (median >= KPI_THRESHOLD.criticalFirstReplyHours) {
    return { status: KPI_STATUS.critical, label: "Slipping" };
  }
  if (median >= KPI_THRESHOLD.warnFirstReplyHours) {
    return { status: KPI_STATUS.warning, label: "Slowing" };
  }
  return { status: KPI_STATUS.good, label: "Fast" };
}
