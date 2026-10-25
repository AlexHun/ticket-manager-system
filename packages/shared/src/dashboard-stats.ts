import type { AutoReplyDecline } from "./auto-reply.ts";
import type {
  TicketAssignee,
  TicketCategory,
  TicketStatus,
} from "./tickets.ts";

/**
 * Who the dashboard is about.
 *
 * `mine` narrows every panel to the caller's own assigned tickets. The id comes
 * from the session, never from the request, so this is a view control and not
 * an authorisation one — there is deliberately no `userId` param to point it at
 * a colleague.
 */
export const DASHBOARD_SCOPE = {
  mine: "mine",
  all: "all",
} as const;

export type DashboardScope =
  (typeof DASHBOARD_SCOPE)[keyof typeof DASHBOARD_SCOPE];

/**
 * The slice of time every panel is computed over, measured on `createdAt`.
 *
 * Presets only. A custom range needs a date-range picker the UI isn't set up
 * for, and these four already answer "this week / this month / this quarter /
 * this year". No "all time": the volume series would grow without bound.
 */
export const DASHBOARD_RANGE = {
  d7: "7d",
  d30: "30d",
  d90: "90d",
  m12: "12m",
} as const;

export type DashboardRange =
  (typeof DASHBOARD_RANGE)[keyof typeof DASHBOARD_RANGE];

export const DEFAULT_DASHBOARD_RANGE: DashboardRange = DASHBOARD_RANGE.d90;

/** How far back each preset reaches, so the SQL and the axis label agree. */
export const DASHBOARD_RANGE_DAYS: Record<DashboardRange, number> = {
  [DASHBOARD_RANGE.d7]: 7,
  [DASHBOARD_RANGE.d30]: 30,
  [DASHBOARD_RANGE.d90]: 90,
  [DASHBOARD_RANGE.m12]: 365,
};

/** Bucket width for the volume series. `date_trunc` takes exactly these names. */
export const DASHBOARD_BUCKET = {
  day: "day",
  week: "week",
  month: "month",
} as const;

export type DashboardBucket =
  (typeof DASHBOARD_BUCKET)[keyof typeof DASHBOARD_BUCKET];

/**
 * Bucket width per range, so no chart ever draws 365 columns or 2. Server-owned:
 * the client only reads the echoed `bucket` to format the axis.
 */
export const DASHBOARD_RANGE_BUCKET: Record<DashboardRange, DashboardBucket> = {
  [DASHBOARD_RANGE.d7]: DASHBOARD_BUCKET.day,
  [DASHBOARD_RANGE.d30]: DASHBOARD_BUCKET.day,
  [DASHBOARD_RANGE.d90]: DASHBOARD_BUCKET.week,
  [DASHBOARD_RANGE.m12]: DASHBOARD_BUCKET.month,
};

/**
 * Hours-to-first-reply bins. These are ordered, which is why they take the
 * single-hue ordinal ramp rather than four separate colours — and why the key
 * order here *is* the render order. Reordering them without reordering the ramp
 * would make the chart say something false about progression.
 */
export const LATENCY_BUCKET = {
  under1h: "under1h",
  h1to4: "h1to4",
  h4to24: "h4to24",
  over24h: "over24h",
} as const;

export type LatencyBucket =
  (typeof LATENCY_BUCKET)[keyof typeof LATENCY_BUCKET];

/** Age-of-open-ticket bins. Same ordering contract as LATENCY_BUCKET. */
export const AGE_BUCKET = {
  under1d: "under1d",
  d1to3: "d1to3",
  d3to7: "d3to7",
  over7d: "over7d",
} as const;

export type AgeBucket = (typeof AGE_BUCKET)[keyof typeof AGE_BUCKET];

/** Row caps. Named here because the panel headings quote them. */
export const NEEDS_ATTENTION_LIMIT = 6;
export const TOP_CUSTOMERS_LIMIT = 8;
export const WORKLOAD_AGENT_LIMIT = 10;

/** A count per status. Keyed by the status values, so a Record and not a shape. */
export type StatusCounts = Record<TicketStatus, number>;

export interface TicketStatsSummary {
  /** Tickets created inside the slice. */
  total: number;
  /** The same count over the window immediately before it — the delta's baseline. */
  previousTotal: number;
  byStatus: StatusCounts;
  /** Open *and* nobody's: the triage queue, the one number with an action attached. */
  openUnassigned: number;
  /**
   * Resolved+Closed as a share of `total`, 0–1. Deliberately not a resolution
   * *time*: there is no resolvedAt column, so this says how much of the slice is
   * settled and nothing about how fast it got there.
   */
  settledShare: number;
}

/**
 * One column of the volume chart.
 *
 * Status keys are flat rather than nested because Recharts addresses a stacked
 * series by `dataKey` — this lets the chart say `dataKey={TICKET_STATUS.Open}`
 * instead of restating the string.
 */
export type TicketVolumePoint = {
  /**
   * Bucket start as a plain calendar date, `YYYY-MM-DD`, already truncated in
   * UTC. Deliberately not an instant: an ISO timestamp re-parsed in a negative
   * offset renders as the previous day, so half the world would see every
   * bucket labelled one day early.
   */
  bucketStart: string;
} & StatusCounts;

export interface TicketCategoryCount {
  /** null is the real "uncategorised" state, not a missing value. */
  category: TicketCategory | null;
  count: number;
}

export interface FirstResponseStats {
  /** Tickets in the slice with at least one outbound message. */
  responded: number;
  /**
   * Tickets in the slice with none. They have no latency, so they are absent
   * from the buckets and the median and reported separately — a median of forty
   * minutes across the tickets anyone answered is not a good first-response time
   * if twice as many were ignored.
   */
  awaiting: number;
  /** null when nothing in the slice was ever replied to. */
  medianHours: number | null;
  p90Hours: number | null;
  buckets: Record<LatencyBucket, number>;
}

export interface BacklogAgeStats {
  /** Open tickets in the slice — the denominator for the buckets. */
  open: number;
  medianAgeHours: number | null;
  buckets: Record<AgeBucket, number>;
}

export interface WorkloadCounts extends StatusCounts {
  total: number;
}

export interface AgentWorkload extends WorkloadCounts {
  id: string;
  name: string;
}

export interface CustomerStats {
  email: string;
  /**
   * The name on their most recent ticket. The same address can arrive under
   * several spellings, and the latest is the one an agent will recognise.
   */
  name: string;
  total: number;
  open: number;
  lastMessageAt: string;
}

export interface NeedsAttentionTicket {
  id: number;
  subject: string;
  customerName: string;
  assignedTo: TicketAssignee | null;
  lastMessageAt: string;
  createdAt: string;
  /**
   * The thread's last word is the customer's, or there is no thread at all, so
   * the ball is on our side. Derived from `direction` — the only signal the
   * schema carries for this.
   */
  waitingOnUs: boolean;
}

/**
 * Everything the dashboard draws, for one slice.
 *
 * One response rather than one per panel: the range and scope controls scope
 * every panel at once, and separate requests would land at separate moments,
 * leaving the KPI row describing a different slice than the chart beside it.
 */
export interface TicketStatsResponse {
  /**
   * Echoed back — the server picks the bucket width and pins the window, and the
   * card subtitles quote both.
   */
  range: DashboardRange;
  scope: DashboardScope;
  bucket: DashboardBucket;
  /** Slice bounds, `[from, to)`, ISO. Every panel below uses exactly these. */
  from: string;
  to: string;
  summary: TicketStatsSummary;
  volume: TicketVolumePoint[];
  categories: TicketCategoryCount[];
  firstResponse: FirstResponseStats;
  backlogAge: BacklogAgeStats;
  /**
   * Agents by ticket count, including those with zero in the slice — an idle
   * agent is information, so they are not filtered out.
   */
  workload: AgentWorkload[];
  /** Tickets nobody owns. Not an agent, so not a row in `workload`. */
  unassigned: WorkloadCounts;
  topCustomers: CustomerStats[];
  needsAttention: NeedsAttentionTicket[];
}

/**
 * Whether the assistant is helping or getting in the way — part of #16.
 *
 * `classified` is the shared denominator for every rate below: tickets the
 * classifier reached a terminal, *successful* verdict on in the slice —
 * `classifierFiled` in the API's `assistant-decisions.ts`, the same statement
 * `machineClassified` counts on `/pipeline` (#561). It reads the classifier's
 * own record of the filing, so a ticket an agent un-categorised since still
 * counts. One statement on purpose: two definitions of "classified" across the
 * same dashboard would disagree on exactly the day someone compared them.
 */
export interface AssistantEffectivenessResponse {
  range: DashboardRange;
  from: string;
  to: string;
  classified: number;
  autoReply: {
    /**
     * Tickets in the slice carrying the auto-resolve stamp — `assistantResolved`
     * in the API's `assistant-decisions.ts`, the same statement `autoResolved`
     * counts on `/pipeline` (#562). A customer's reopen clears the stamp, so it
     * withdraws the resolution here and there alike; an agent's reassignment or
     * status change touches neither. Not the assignee: a resolved ticket is
     * filed under the assistant's account, but that is who owns it, which an
     * agent may change, and the two disagreed as soon as an agent reassigned one.
     */
    resolved: number;
    /** `resolved / classified`. Null, not 0, when nothing was classified — there is no rate to report. */
    rate: number | null;
  };
  decline: {
    /**
     * Tickets the auto-reply reached a verdict on and that verdict was "no" —
     * `DECLINE_OUTCOME`'s nine, not every ticket carrying a reason. An
     * `unavailable` ticket decided nothing, and folding it in here inflated the
     * rate below with outages (`docs/adr/0019`).
     */
    count: number;
    /** `count / classified`. Null, not 0, when nothing was classified. */
    rate: number | null;
    /**
     * Every reason, including the zeroes — a zero is information. The same
     * tally as `/pipeline`'s `declines`, both taken from `windowCounts` in the
     * API's `assistant-decisions.ts` (#563). Unfiltered on purpose: this
     * breaks the column down by reason, and a reason is what the column
     * honestly holds, so `unavailable` keeps its own count here while staying
     * out of `count` and `rate`.
     */
    reasons: Record<AutoReplyDecline, number>;
  };
  categoryOverride: {
    /** Tickets the classifier filed a category on where an agent later changed it. */
    count: number;
    rate: number | null;
  };
  /**
   * Average edit distance between a polished draft and what an agent actually
   * sent, over every `Message` in the slice with both halves of that pair (see
   * `Message.polishedDraft`, persisted by the sibling chunk, #20). `null` when
   * the slice has no such pair yet, not `0` — there is no rate to report.
   *
   * A plain Levenshtein distance in Node was measured too slow to compute
   * inline: a 10k-character pair (the ceiling `MAX_MESSAGE_BODY_LENGTH` allows)
   * took ~14-18s, and even 50 pairs of ordinary ~400-character replies took
   * ~1s, blocking the event loop for the length of the request.
   * `apps/api/src/routes/ticket-effectiveness-edit-distance.ts` computes this
   * with Ukkonen's banded algorithm instead — cheap in proportion to how
   * different the two strings actually are, which for a lightly-edited draft
   * is small.
   */
  avgEditDistance: number | null;
}
