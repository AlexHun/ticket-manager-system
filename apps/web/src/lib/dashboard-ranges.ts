import { DASHBOARD_RANGE, type DashboardRange } from "@ticket/shared";

/**
 * The time-range presets the dashboard and the pipeline both offer, shortest
 * first so a toggle group reads as a scale.
 *
 * `label` is the API's own preset value, short enough for a toggle; `span`
 * spells the unit out for a sentence or an accessible name, since "the last
 * 7d" is not a phrase anyone says. One table, so the two screens cannot word
 * the same range two ways.
 */
export const DASHBOARD_RANGE_OPTIONS: {
  value: DashboardRange;
  label: string;
  span: string;
}[] = [
  { value: DASHBOARD_RANGE.d7, label: "7d", span: "7 days" },
  { value: DASHBOARD_RANGE.d30, label: "30d", span: "30 days" },
  { value: DASHBOARD_RANGE.d90, label: "90d", span: "90 days" },
  { value: DASHBOARD_RANGE.m12, label: "12m", span: "12 months" },
];
