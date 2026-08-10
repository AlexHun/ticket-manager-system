export const TICKET_STATUS = {
  Open: "Open",
  Resolved: "Resolved",
  Closed: "Closed",
} as const;

export type TicketStatus = (typeof TICKET_STATUS)[keyof typeof TICKET_STATUS];

export const TICKET_CATEGORY = {
  General: "General",
  Technical: "Technical",
  Refund: "Refund",
  Other: "Other",
} as const;

export type TicketCategory =
  (typeof TICKET_CATEGORY)[keyof typeof TICKET_CATEGORY];

export const USER_ROLE = {
  admin: "admin",
  agent: "agent",
} as const;

export type UserRole = (typeof USER_ROLE)[keyof typeof USER_ROLE];

export interface Ticket {
  id: number;
  subject: string;
  status: TicketStatus;
  category: TicketCategory | null;
  customerEmail: string;
  customerName: string;
  assignedToId: string | null;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Columns the tickets list can be sorted by. Doubles as the table's column ids
 * on the client and as the key into the API's orderBy map, so the two stay
 * in step by construction.
 */
export const TICKET_SORT_FIELD = {
  subject: "subject",
  customerName: "customerName",
  status: "status",
  category: "category",
  /** Sorts by the assignee's *name*, not the id — the id is a cuid and orders by nothing a reader can see. */
  assignedTo: "assignedTo",
  createdAt: "createdAt",
} as const;

export type TicketSortField =
  (typeof TICKET_SORT_FIELD)[keyof typeof TICKET_SORT_FIELD];

export const SORT_ORDER = {
  asc: "asc",
  desc: "desc",
} as const;

export type SortOrder = (typeof SORT_ORDER)[keyof typeof SORT_ORDER];

/** What the API sorts by when the request carries no sort params. */
export const DEFAULT_TICKET_SORT = {
  field: TICKET_SORT_FIELD.createdAt,
  order: SORT_ORDER.desc,
} as const;

/**
 * Query-param sentinel for "this ticket has no category". A null can't travel
 * in a query string, and an absent `category` already means "any category".
 */
export const CATEGORY_NONE = "none";

export type TicketCategoryFilter = TicketCategory | typeof CATEGORY_NONE;

/** Longest accepted free-text search, mirrored by the zod schema. */
export const TICKET_SEARCH_MAX_LENGTH = 100;

/** Page sizes offered in the UI. The API accepts any size up to MAX_PAGE_SIZE. */
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

export const DEFAULT_PAGE_SIZE = 25;

/** Ceiling on `pageSize`, so one request can't ask for the whole table. */
export const MAX_PAGE_SIZE = 100;

/** Pages are 1-based on the wire; TanStack's 0-based index is mapped client-side. */
export const FIRST_PAGE = 1;

export const MESSAGE_DIRECTION = {
  inbound: "inbound",
  outbound: "outbound",
} as const;

export type MessageDirection =
  (typeof MESSAGE_DIRECTION)[keyof typeof MESSAGE_DIRECTION];

/**
 * Longest reply an agent can send, mirrored by the zod schema in `@ticket/core`.
 *
 * A sanity bound on one request rather than a style rule: a real answer with a
 * quoted history under it fits comfortably, and a megabyte pasted into the box
 * does not. Lives here so the composer and the server agree on the number
 * without either one restating it.
 */
export const MAX_MESSAGE_BODY_LENGTH = 10_000;

export interface Message {
  id: number;
  ticketId: number;
  messageId: string;
  inReplyTo: string | null;
  senderEmail: string;
  senderName: string;
  textBody: string | null;
  htmlBody: string | null;
  direction: MessageDirection;
  /**
   * The agent who wrote it, for an outbound reply. Null on everything inbound —
   * a customer has no row in the user table — and null again once that agent is
   * deleted, so this is a credit line and never an ownership claim.
   */
  authorId: string | null;
  createdAt: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  emailVerified: boolean;
  createdAt: string;
}

export interface TicketsListResponse {
  /**
   * One page of tickets, already sorted and filtered by the server.
   *
   * Assignees are resolved server-side because the list renders them: an
   * `assignedToId` alone is a cuid, and an agent has no route to turn it into a
   * name — `/api/tickets/assignees` only lists who is still assignable.
   */
  tickets: TicketWithAssignee[];
  /** Tickets matching the current filters, ignoring pagination. */
  total: number;
  /** Echoed back because the server clamps both. 1-based. */
  page: number;
  pageSize: number;
}

/**
 * Ceiling on a ticket id. Postgres `Int` is int4, so an id above this can't
 * exist — rejecting it up front keeps a hand-typed URL from reaching Prisma,
 * which would throw on the conversion and turn a bad request into a 500.
 */
export const MAX_TICKET_ID = 2_147_483_647;

/**
 * The assignee fields the detail view renders. Picked from `User` rather than
 * re-declared, and deliberately without role/emailVerified — a ticket view is
 * not a window onto the user table.
 */
export type TicketAssignee = Pick<User, "id" | "name" | "email">;

/**
 * A thread message as the API serves it.
 *
 * `htmlBody` is absent by design: it is whatever a stranger emailed support, so
 * it never leaves the database. `authorId` is absent for a duller reason —
 * nothing in the thread renders it. `senderName` and `senderEmail` are written
 * from the session at reply time and are what the bubble shows, so the id would
 * be an internal handle travelling for nobody. Keeping both out of the type
 * means a route that tried to send them wouldn't compile.
 */
export type ThreadMessage = Omit<Message, "htmlBody" | "authorId">;

/** A ticket whose assignee has been looked up for us. */
export interface TicketWithAssignee extends Ticket {
  /** Resolved server-side: `assignedToId` alone can't be looked up by an agent. */
  assignedTo: TicketAssignee | null;
}

/** A ticket plus the two things only the detail view needs. */
export interface TicketDetail extends TicketWithAssignee {
  /** The whole thread, oldest first. */
  messages: ThreadMessage[];
}

export interface TicketDetailResponse {
  ticket: TicketDetail;
}

/**
 * Everyone a ticket can be handed to.
 *
 * Served by the tickets API rather than `/api/users`, which is admin-only:
 * agents assign tickets too, and this is the one slice of the user table they
 * need to do it.
 */
export interface TicketAssigneesResponse {
  assignees: TicketAssignee[];
}

/**
 * The reply to an assignment change. No `messages` — reassigning doesn't touch
 * the thread, and re-sending it would grow with every reply on the ticket.
 */
export interface UpdateTicketResponse {
  ticket: TicketWithAssignee;
}

/**
 * The reply to a posted message. Just the message — the client is already
 * holding the thread and only needs the one entry to add to the end of it, and
 * re-sending the whole thing would grow with every reply on the ticket. Same
 * reasoning as `UpdateTicketResponse` carrying no `messages`.
 *
 * The ticket's `lastMessageAt` moved too, and is deliberately not echoed: it is
 * exactly this message's `createdAt`, because the route writes both from a
 * single instant inside one transaction.
 */
export interface CreateTicketMessageResponse {
  message: ThreadMessage;
}

export interface UsersListResponse {
  users: User[];
}

export interface CreateUserResponse {
  user: User;
}

export interface UpdateUserResponse {
  user: User;
}

export interface HealthResponse {
  status: "ok";
}

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
