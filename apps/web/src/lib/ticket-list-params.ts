import type { ZodType } from "zod";
import { ticketsQuerySchema, type TicketsQuery } from "@ticket/core";
import {
  DEFAULT_PAGE_SIZE,
  DEFAULT_TICKET_SORT,
  FIRST_PAGE,
} from "@ticket/shared";
import { ROUTE } from "./routes";

/**
 * Router state carried from the tickets list to a ticket detail page.
 *
 * The detail URL stays clean (`/tickets/12` is shareable, and shouldn't hand a
 * stranger someone else's filters), so the list's query string travels in
 * history state instead — which is what lets "Back to tickets" land on the same
 * filtered, sorted, paginated view.
 */
export interface TicketListLocationState {
  listSearch?: string;
}

/**
 * The list URL to return to. Falls back to a bare `/tickets` when there is no
 * state to read — a shared link or a page reloaded from a bookmark arrives
 * without one, and `navigate(-1)` would be worse there: the previous entry may
 * not be the list at all.
 */
export function listPathFrom(state: unknown): string {
  const listSearch = (state as TicketListLocationState | null)?.listSearch;
  return `${ROUTE.tickets.path}${listSearch ?? ""}`;
}

/**
 * The URL param names are the API's param names, so the list URL *is* the
 * request — there is no second vocabulary to keep in step.
 */
export const LIST_PARAM = {
  sort: "sort",
  order: "order",
  status: "status",
  category: "category",
  assignedTo: "assignedTo",
  q: "q",
  page: "page",
  pageSize: "pageSize",
} as const;

/** Server-side defaults. A param holding one of these is dropped from the URL. */
const DEFAULTS = {
  [LIST_PARAM.sort]: DEFAULT_TICKET_SORT.field,
  [LIST_PARAM.order]: DEFAULT_TICKET_SORT.order,
  [LIST_PARAM.page]: FIRST_PAGE,
  [LIST_PARAM.pageSize]: DEFAULT_PAGE_SIZE,
} as const;

const shape = ticketsQuerySchema.shape;

/**
 * Parse one param, falling back rather than throwing.
 *
 * The schema is the single source of truth for what a valid value *is* — reusing
 * its fields means a new sort field or a raised page cap can't be accepted in
 * one place and rejected in the other. But a URL is user-editable and stale
 * links outlive deploys, so the UI has to recover where the API rejects: one bad
 * param must not throw away the six good ones beside it.
 */
function field<T>(schema: ZodType<T>, raw: string | null, fallback: T): T {
  if (raw === null) return fallback;
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : fallback;
}

/** The list state encoded in a URL, ready to be sent as request params. */
export function parseTicketListParams(sp: URLSearchParams): TicketsQuery {
  return {
    sort: field(shape.sort, sp.get(LIST_PARAM.sort), DEFAULT_TICKET_SORT.field),
    order: field(
      shape.order,
      sp.get(LIST_PARAM.order),
      DEFAULT_TICKET_SORT.order,
    ),
    status: field(shape.status, sp.get(LIST_PARAM.status), undefined),
    category: field(shape.category, sp.get(LIST_PARAM.category), undefined),
    assignedTo: field(shape.assignedTo, sp.get(LIST_PARAM.assignedTo), undefined),
    q: field(shape.q, sp.get(LIST_PARAM.q), undefined),
    page: field(shape.page, sp.get(LIST_PARAM.page), FIRST_PAGE),
    pageSize: field(
      shape.pageSize,
      sp.get(LIST_PARAM.pageSize),
      DEFAULT_PAGE_SIZE,
    ),
  };
}

export type TicketListPatch = Partial<TicketsQuery>;

/**
 * Apply a patch to the current params.
 *
 * Values equal to the server's default — or empty — are removed rather than
 * written, so the resting URL is a bare `/tickets` and a shared link carries
 * only what was actually chosen.
 *
 * Any change other than an explicit page move drops `page`: re-sorting or
 * re-filtering rebuilds the result set, so page 3 of the old one means nothing
 * in the new one and is often past the end. That rule lives here, once, instead
 * of in each handler.
 */
export function writeTicketListParams(
  current: URLSearchParams,
  patch: TicketListPatch,
): URLSearchParams {
  const next = new URLSearchParams(current);

  for (const [key, value] of Object.entries(patch)) {
    const isDefault = value === DEFAULTS[key as keyof typeof DEFAULTS];
    if (value === undefined || value === "" || isDefault) {
      next.delete(key);
    } else {
      next.set(key, String(value));
    }
  }

  if (!(LIST_PARAM.page in patch)) {
    next.delete(LIST_PARAM.page);
  }

  return next;
}
