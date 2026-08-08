import {
  AGE_BUCKET,
  TICKET_STATUS,
  type AgentWorkload,
  type BacklogAgeStats,
  type TicketCategoryCount,
  type WorkloadCounts,
} from "@ticket/shared";
import type { MiniBarRow } from "./MiniBarList";
import { AGE_LABEL, ORDINAL_FILL, UNCATEGORISED_LABEL } from "./chart-tokens";

const UNASSIGNED_LABEL = "Unassigned";

/**
 * Row builders for the panels that used to be Recharts charts.
 *
 * They live apart from `MiniBarList` so that component stays a dumb renderer and
 * each panel's ordering rules — which are the actual editorial decisions — sit
 * together where they can be compared.
 */

/**
 * Categories, biggest first, with "no category yet" pinned last.
 *
 * Pinned regardless of size for the same reason it always was: an untriaged pile
 * is a different kind of thing from the real categories, and sorting it into the
 * middle of them implies it is one of them.
 */
export function categoryRows(
  categories: TicketCategoryCount[],
): MiniBarRow[] {
  const named = categories
    .filter((c) => c.category !== null)
    .sort((a, b) => b.count - a.count)
    .map((c) => ({ label: String(c.category), value: c.count }));

  const uncategorised = categories.find((c) => c.category === null);
  return uncategorised
    ? [...named, { label: UNCATEGORISED_LABEL, value: uncategorised.count }]
    : named;
}

/**
 * Tickets per assignee, with the unowned pile last.
 *
 * Agents with nothing in the slice are kept: an idle queue is information, and
 * dropping the row would quietly change the question from "who has tickets" to
 * "who has any". The note column carries how many of each row are still open,
 * which is what the stacked bar used to say and the only part of it anyone acted
 * on.
 */
export function workloadRows(
  workload: AgentWorkload[],
  unassigned: WorkloadCounts,
): MiniBarRow[] {
  const rows: MiniBarRow[] = workload.map((agent) => ({
    label: agent.name,
    value: agent.total,
    note: agent[TICKET_STATUS.Open] > 0 ? `${agent[TICKET_STATUS.Open]} open` : undefined,
  }));

  if (unassigned.total > 0) {
    rows.push({
      label: UNASSIGNED_LABEL,
      value: unassigned.total,
      note:
        unassigned[TICKET_STATUS.Open] > 0
          ? `${unassigned[TICKET_STATUS.Open]} open`
          : undefined,
    });
  }
  return rows;
}

const AGE_ORDER = [
  AGE_BUCKET.under1d,
  AGE_BUCKET.d1to3,
  AGE_BUCKET.d3to7,
  AGE_BUCKET.over7d,
] as const;

/**
 * Open backlog by age.
 *
 * Ordinal, not categorical — the buckets have a direction — so the rows keep the
 * one-hue ramp the chart used, darkening with age. Bucket order is fixed and
 * never sorted by size: re-ordering these would destroy the only thing the
 * colour is encoding.
 */
export function backlogAgeRows(stats: BacklogAgeStats): MiniBarRow[] {
  return AGE_ORDER.map((bucket, i) => ({
    label: AGE_LABEL[bucket],
    value: stats.buckets[bucket],
    fill: ORDINAL_FILL[Math.min(i, ORDINAL_FILL.length - 1)],
  }));
}
