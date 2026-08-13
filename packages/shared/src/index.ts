/**
 * A ticket's lifecycle, in order:
 *
 *   New ──► Processing ──► Resolved         the knowledge base answered it
 *    │           └───────► Open             it declined; a human's turn
 *    └──────────────────► Open ──► Resolved ──► Closed
 *
 * The key order is the *declaration* order of the Postgres enum, which is how
 * Postgres sorts it and therefore what "sort by status" means in the list. Keep
 * the two in step: reordering here without a matching migration silently changes
 * the order of a column nobody thought they were touching.
 *
 * `New` is where a ticket arrives and where it stays until something moves it.
 * Only the auto-reply pipeline does that automatically, so a deployment with no
 * AI key leaves every ticket here — which is the honest reading of "nobody has
 * triaged this yet", and the reason the dashboard counts New as backlog
 * alongside Open.
 *
 * `Processing` means a worker is composing a reply for this ticket right now.
 * It is the one status the tickets list hides, so that an agent cannot open a
 * ticket the model is about to answer and write a second reply to it. It lasts
 * seconds, and nothing outside the job that set it may put a ticket into it —
 * see `AGENT_SETTABLE_STATUS`.
 */
export const TICKET_STATUS = {
  New: "New",
  Processing: "Processing",
  Open: "Open",
  Resolved: "Resolved",
  Closed: "Closed",
} as const;

export type TicketStatus = (typeof TICKET_STATUS)[keyof typeof TICKET_STATUS];

/**
 * The statuses a client may *filter* by.
 *
 * Everything but `Processing`, because the list refuses to show those rows at
 * all — offering a filter that is guaranteed to return nothing is worse than
 * rejecting it, and rejecting it says why.
 */
export const CLIENT_TICKET_STATUS = [
  TICKET_STATUS.New,
  TICKET_STATUS.Open,
  TICKET_STATUS.Resolved,
  TICKET_STATUS.Closed,
] as const;

export type ClientTicketStatus = (typeof CLIENT_TICKET_STATUS)[number];

/**
 * The statuses a person may *set*.
 *
 * `Processing` is excluded because it is a claim held by a background worker: a
 * person setting it by hand would hide a ticket from everyone else with nothing
 * on its way to un-hide it. `New` is excluded because it is where a ticket
 * begins and there is nothing to be gained from putting one back — an agent who
 * wants to disown a ticket clears the assignee.
 *
 * Enforced server-side by `updateTicketStatusSchema`; the picker in the UI only
 * offers these because the API only accepts these.
 */
export const AGENT_SETTABLE_STATUS = [
  TICKET_STATUS.Open,
  TICKET_STATUS.Resolved,
  TICKET_STATUS.Closed,
] as const;

export type AgentSettableStatus = (typeof AGENT_SETTABLE_STATUS)[number];

/**
 * Statuses that mean "nobody has dealt with this yet".
 *
 * `New` and `Open` both count: before the two were split, every unhandled ticket
 * was Open, and every backlog metric was written as `status = Open`. Leaving
 * them that way would have made a deployment with no AI key report an empty
 * queue while every ticket in it sat unread in `New`.
 */
export const BACKLOG_STATUS = [
  TICKET_STATUS.New,
  TICKET_STATUS.Open,
] as const;

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

/**
 * Why the knowledge-base auto-reply left a ticket for a person.
 *
 * Declining is the designed, common outcome — most support mail is not a
 * knowledge-base question, and six checks fail closed on the rest. Until this
 * existed none of that reached anyone: a declined ticket and a ticket the
 * machine never looked at were the same `Open` row, so an agent could not learn
 * the system's edges and an admin could not tell a working knowledge base from
 * a broken one. The reason was written to a log line and nowhere else.
 *
 * Deliberately finer than `AutoReplyFailure` in the API, which drives *retries*
 * and must stay coarse — four different checks all mean "do not try again" to
 * pg-boss and four different things to a person reading the ticket. The two
 * travel together and neither replaces the other.
 *
 * The ordering below is the order they occur in: three gates before the model is
 * called, then its own verdict, then the checks over what it wrote.
 */
export const AUTO_REPLY_DECLINE = {
  /** Refund, or still unclassified. A machine may not answer either. */
  category: "category",
  /** Somebody had already replied — the corpus answers openings, not threads. */
  answered: "answered",
  /** The opening email had no plain text to read. */
  noText: "noText",
  /** It read the corpus and said this is not covered. The common one. */
  notCovered: "notCovered",
  /** It answered, but cited nothing that resolves against the corpus. */
  noCitation: "noCitation",
  /** The reply promised money its cited articles do not mention. */
  unbackedCommitment: "unbackedCommitment",
  /** The reply carried a link or address its cited articles do not contain. */
  unbackedReference: "unbackedReference",
  /** Longer than a knowledge-base answer has any business being. */
  tooLong: "tooLong",
  /** The provider failed, or the retry ladder ran out. Not a judgement. */
  unavailable: "unavailable",
} as const;

export type AutoReplyDecline =
  (typeof AUTO_REPLY_DECLINE)[keyof typeof AUTO_REPLY_DECLINE];

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
  /**
   * When anything last happened on the thread, in either direction.
   *
   * This is the column a support queue is actually about: `createdAt` says when
   * a ticket arrived and never changes again, so a customer who replies to a
   * three-week-old ticket stays three weeks down the list under it. Ascending
   * is "longest silence first", which is the order the dashboard's
   * needs-attention panel already uses.
   */
  lastMessageAt: "lastMessageAt",
  createdAt: "createdAt",
} as const;

export type TicketSortField =
  (typeof TICKET_SORT_FIELD)[keyof typeof TICKET_SORT_FIELD];

export const SORT_ORDER = {
  asc: "asc",
  desc: "desc",
} as const;

export type SortOrder = (typeof SORT_ORDER)[keyof typeof SORT_ORDER];

/**
 * What the API sorts by when the request carries no sort params.
 *
 * Most recent activity first, not most recently created. The two agree on a
 * quiet queue and diverge exactly when it matters: a customer replying to an
 * old ticket moves it to the top here, where sorting by `createdAt` left it
 * buried under three weeks of newer arrivals and no column on the page showed
 * that anything had happened.
 *
 * Descending rather than ascending, deliberately. "Longest silence first" is
 * the more pointed question, but it is only meaningful for tickets still in
 * play — as a *default*, over a list that includes Resolved and Closed, it
 * would head the page with the deadest threads in the database. It is one
 * click away instead: sort by the same column ascending, with a status filter.
 */
export const DEFAULT_TICKET_SORT = {
  field: TICKET_SORT_FIELD.lastMessageAt,
  order: SORT_ORDER.desc,
} as const;

/**
 * Query-param sentinel for "this ticket has no category". A null can't travel
 * in a query string, and an absent `category` already means "any category".
 */
export const CATEGORY_NONE = "none";

export type TicketCategoryFilter = TicketCategory | typeof CATEGORY_NONE;

/**
 * Query-param sentinel for "nobody is assigned to this ticket" — the same
 * problem CATEGORY_NONE solves, for the assignee filter: a null can't travel in
 * a query string, and an absent `assignedTo` already means "any assignee".
 *
 * Its own constant rather than a shared one, because the two filters are free to
 * diverge; the values only happen to match today. It can't be mistaken for a
 * real assignee either — ids are Better Auth cuids, 32 characters long.
 */
export const ASSIGNEE_NONE = "none";

/**
 * Query-param sentinel for the whole backlog at once — `New` and `Open`
 * together, which is what `BACKLOG_STATUS` means everywhere else here.
 *
 * It exists because the status filter takes one value and "nobody has dealt with
 * this" is two. Every dashboard number carrying that meaning spans both, so
 * until this existed there was no way to click one of those numbers and land on
 * the set it had counted: `status=Open` silently dropped every untriaged ticket,
 * and omitting the filter swept in everything already resolved and closed. Both
 * shipped at different times and both were wrong in a way you could not see from
 * the page you landed on, because a plausible list of tickets looks the same
 * either way.
 *
 * Never stored and not a `TicketStatus` — it names a set, and it is resolved to
 * `BACKLOG_STATUS` at the single place that builds the query. It cannot be
 * mistaken for a real status either: those are capitalised.
 */
export const STATUS_BACKLOG = "backlog";

/** What the status filter accepts: one status, or the backlog as a set. */
export type ClientTicketStatusFilter =
  | ClientTicketStatus
  | typeof STATUS_BACKLOG;

/**
 * The saved views in the sidebar: the four questions an agent opens the queue to
 * ask, each one a ticket-list filter that already existed.
 *
 * Every view is backlog-scoped, and that is the point of the sentinel above. An
 * "Unassigned" that counted resolved and closed tickets would be answering a
 * question nobody asked — on the dev data it is 62 tickets against the 25 that
 * are actually waiting for an owner.
 */
export const TICKET_VIEW = {
  backlog: "backlog",
  unassigned: "unassigned",
  mine: "mine",
  untriaged: "untriaged",
} as const;

export type TicketView = (typeof TICKET_VIEW)[keyof typeof TICKET_VIEW];

/** Render order, narrowest last: the whole queue, then three cuts of it. */
export const TICKET_VIEWS = [
  TICKET_VIEW.backlog,
  TICKET_VIEW.unassigned,
  TICKET_VIEW.mine,
  TICKET_VIEW.untriaged,
] as const;

/**
 * The ticket-list query a view stands for, as the params it travels in.
 *
 * One definition for both ends, and that is the whole design: the sidebar builds
 * its `href` from this, and the API counts each view by feeding the same object
 * through `ticketsQuerySchema` into the same `buildWhere` the list uses. A count
 * and the page it links to therefore cannot disagree without the params object
 * itself being wrong — which is a single table to read rather than two
 * implementations to compare.
 *
 * That is not hypothetical tidiness. Both shipped mismatches this replaces were
 * the same bug: a number computed one way and a link written another.
 *
 * `viewerId` is only consulted by `mine`, and the server passes the *session's*
 * id rather than anything from the request, so the view cannot be pointed at a
 * colleague.
 */
export function ticketViewParams(
  view: TicketView,
  viewerId: string,
): Record<string, string> {
  switch (view) {
    case TICKET_VIEW.backlog:
      return { status: STATUS_BACKLOG };
    case TICKET_VIEW.unassigned:
      return { status: STATUS_BACKLOG, assignedTo: ASSIGNEE_NONE };
    case TICKET_VIEW.mine:
      return { status: STATUS_BACKLOG, assignedTo: viewerId };
    case TICKET_VIEW.untriaged:
      return { status: STATUS_BACKLOG, category: CATEGORY_NONE };
  }
}

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
  /**
   * This reply was written by the knowledge-base auto-reply, not by a person.
   *
   * Its own field rather than something inferred from `authorId`, which is null
   * on an automated reply and *also* null on a reply whose author has since been
   * deleted. Those two are not the same thing and an agent reading a thread has
   * to be able to tell them apart, so the fact is recorded rather than guessed.
   */
  automated: boolean;
  /**
   * The knowledge-base articles an automated reply was built from — `["KB-004"]`.
   *
   * Always empty on anything a person wrote and on everything inbound, so an
   * agent reading the thread can tell "a machine sent this, from these articles"
   * from "a colleague sent this". Every id here resolved against the corpus the
   * model was actually given, because a reply whose citations did not resolve
   * was thrown away rather than sent — see check 4 in `ai/auto-reply.ts`.
   *
   * Safe to render. These are ids from our own file, not model output: the
   * strings that reached the database are the ids of articles that were looked
   * up and found, never the raw text the model returned.
   */
  citedArticleIds: string[];
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

/** A ticket plus the things only the detail view needs. */
export interface TicketDetail extends TicketWithAssignee {
  /** The whole thread, oldest first. */
  messages: ThreadMessage[];
  /**
   * Why the auto-reply left this one for a person, and when.
   *
   * On `TicketDetail` rather than on `Ticket`, so it does not ride along on
   * every row of a 25-row list that has nowhere to show it. Null on the great
   * majority of tickets: a human-created ticket, one the machine answered, and
   * one it has not reached yet all read the same here — this says only "it
   * looked, and here is what it concluded".
   */
  autoReplyDecline: AutoReplyDecline | null;
  autoReplyDeclinedAt: string | null;
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
 * How many tickets each saved view holds.
 *
 * A `Record` over every view rather than a list of whatever was non-zero: the
 * sidebar draws a fixed set of rows, and a missing key would be indistinguishable
 * from a count of nought while quietly shifting the layout. Adding a view is a
 * compile error here until it is counted.
 */
export interface TicketViewCountsResponse {
  counts: Record<TicketView, number>;
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

/**
 * The reply to POST /api/ai/polish-reply.
 *
 * Plain text, never markup. The composer puts it straight into a textarea and
 * the thread renders `textBody` as a React text node, so anything HTML-shaped
 * would be shown literally at best — see the "never render email HTML" rule.
 *
 * Nothing is persisted by that endpoint, which is why there is no message here
 * and no id: the rewrite exists only in the agent's draft box until they send it.
 */
export interface PolishReplyResponse {
  polished: string;
}

/**
 * How the customer is coming across, as the summary reads them.
 *
 * Four levels rather than the usual positive/neutral/negative three, because the
 * axis a support desk actually triages on is heat, and "negative" flattens the
 * two ends of it that need different handling: a frustrated customer wants their
 * answer, an angry one is deciding whether to escalate. `neutral` is the honest
 * answer for a matter-of-fact report and is what a thread with nothing to read
 * gets — this is never left blank.
 */
export const SUMMARY_SENTIMENT = {
  positive: "positive",
  neutral: "neutral",
  frustrated: "frustrated",
  angry: "angry",
} as const;

export type SummarySentiment =
  (typeof SUMMARY_SENTIMENT)[keyof typeof SUMMARY_SENTIMENT];

/**
 * What the model is asked to produce about one ticket.
 *
 * Structured rather than a paragraph, because the panel renders each part
 * differently and an agent reads them at different moments: the overview answers
 * "what is this", the points answer "what has happened", the next step answers
 * "what do I do", and the sentiment is the thing they see before any of it. A
 * single blob would have to be re-parsed to lay out that way, and the model
 * would decide the shape afresh on every regeneration.
 *
 * Plain text throughout, never markup — same rule as `PolishReplyResponse`, and
 * for the same reason: this is rendered as React text nodes.
 */
export interface TicketSummary {
  /** One or two sentences: what the ticket is about and where it currently stands. */
  overview: string;
  /**
   * What happened in the thread, oldest development first. Empty on a ticket
   * whose thread says nothing beyond its overview — a bulleted restatement of
   * the sentence above it is noise, so the model is allowed to return none.
   */
  keyPoints: string[];
  /**
   * The one thing the agent should do next, or null when the thread has nothing
   * outstanding. Nullable rather than a "nothing to do" string so the panel can
   * leave the section out instead of printing a shrug.
   */
  nextStep: string | null;
  sentiment: SummarySentiment;
  /**
   * The words in the three fields above that must not be skimmed past: order and
   * ticket references, amounts, dates, error text, and whatever names the thing
   * that is blocked. The panel marks each occurrence.
   *
   * Substrings, not concepts — every entry is guaranteed to occur verbatim
   * (case-insensitively) somewhere in `overview`, `keyPoints` or `nextStep`,
   * because the server drops any that does not. A client can therefore match
   * them literally and expect a hit, and an empty list is a normal answer for a
   * summary with nothing worth singling out.
   */
  highlights: string[];
}

/**
 * The reply to POST /api/ai/summarize-ticket.
 *
 * Nothing is persisted, so there is no id and no `generatedAt`: the summary
 * exists in the panel that asked for it until the agent asks again, which is the
 * whole contract — every click is a fresh generation.
 *
 * `messageCount` is how long the thread was when the summary was made, and it is
 * the reason this is not just a `TicketSummary`. The client holds the thread
 * too, so comparing the two is what lets the panel notice that a reply has
 * landed since and say so, rather than showing a confident summary of a
 * conversation that has moved on.
 *
 * Deliberately the whole thread's length rather than the number of messages that
 * reached the model — an HTML-only email carries no `textBody` and is skipped by
 * the prompt, but it is still a message the agent can see in the thread, and a
 * count that disagreed with the one on screen would make the staleness check
 * fire at nothing.
 */
export interface SummarizeTicketResponse {
  summary: TicketSummary;
  messageCount: number;
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
