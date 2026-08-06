import type { ZodType } from "zod";
import { ticketStatsQuerySchema, type TicketStatsQuery } from "@ticket/core";
import { DASHBOARD_SCOPE, DEFAULT_DASHBOARD_RANGE } from "@ticket/shared";

/**
 * The URL param names are the API's param names, so the dashboard URL *is* the
 * request — the same arrangement as the tickets list, and for the same reason:
 * there is no second vocabulary to keep in step.
 */
export const DASHBOARD_PARAM = {
  range: "range",
  scope: "scope",
} as const;

/** Server-side defaults. A param holding one of these is dropped from the URL,
 *  so the dashboard's resting state is a bare `/`. */
const DEFAULTS = {
  [DASHBOARD_PARAM.range]: DEFAULT_DASHBOARD_RANGE,
  [DASHBOARD_PARAM.scope]: DASHBOARD_SCOPE.all,
} as const;

const shape = ticketStatsQuerySchema.shape;

/**
 * Parse one param, falling back rather than throwing.
 *
 * Same contract as `parseTicketListParams`: the schema decides what is valid, so
 * the client and the API can't disagree — but a URL is user-editable and stale
 * links outlive deploys, so one bad param must not discard the good one beside it.
 */
function field<T>(schema: ZodType<T>, raw: string | null, fallback: T): T {
  if (raw === null) return fallback;
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : fallback;
}

export function parseDashboardParams(sp: URLSearchParams): TicketStatsQuery {
  return {
    range: field(
      shape.range,
      sp.get(DASHBOARD_PARAM.range),
      DEFAULT_DASHBOARD_RANGE,
    ),
    scope: field(
      shape.scope,
      sp.get(DASHBOARD_PARAM.scope),
      DASHBOARD_SCOPE.all,
    ),
  };
}

export type DashboardPatch = Partial<TicketStatsQuery>;

export function writeDashboardParams(
  current: URLSearchParams,
  patch: DashboardPatch,
): URLSearchParams {
  const next = new URLSearchParams(current);

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === DEFAULTS[key as keyof typeof DEFAULTS]) {
      next.delete(key);
    } else {
      next.set(key, String(value));
    }
  }

  return next;
}
