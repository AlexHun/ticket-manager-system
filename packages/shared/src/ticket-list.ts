import type {
  ClientTicketStatus,
  TicketCategory,
  TicketWithAssignee,
} from "./tickets.ts";

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
 * together, which is what `BACKLOG_STATUS` (`tickets.ts`) means everywhere else.
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
  ClientTicketStatus | typeof STATUS_BACKLOG;

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
