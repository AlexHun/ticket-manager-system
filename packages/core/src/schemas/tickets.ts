import { z } from "zod";
import {
  CATEGORY_NONE,
  DASHBOARD_RANGE,
  DASHBOARD_SCOPE,
  DEFAULT_DASHBOARD_RANGE,
  DEFAULT_PAGE_SIZE,
  DEFAULT_TICKET_SORT,
  FIRST_PAGE,
  MAX_MESSAGE_BODY_LENGTH,
  MAX_PAGE_SIZE,
  MAX_TICKET_ID,
  SORT_ORDER,
  TICKET_CATEGORY,
  TICKET_SEARCH_MAX_LENGTH,
  TICKET_SORT_FIELD,
  TICKET_STATUS,
} from "@ticket/shared";

/**
 * Sanity ceiling on an assignee id, shared by the list filter and the assign
 * body. Better Auth generates 32-character ids, so anything near this is already
 * nonsense — the cap just keeps a request from turning an arbitrarily long
 * string into a database lookup.
 */
const ASSIGNEE_ID_MAX_LENGTH = 128;

/**
 * Query params for GET /api/tickets.
 *
 * Sort params default, so omitting them yields the newest-first order the list
 * page asks for on first load. Filter params are optional and absent means
 * "don't narrow on this field" — `category=none` and `assignedTo=none` are the
 * sentinels for tickets that have no category and no owner at all.
 */
export const ticketsQuerySchema = z.object({
  sort: z
    .enum(TICKET_SORT_FIELD, { error: "Invalid sort field" })
    .default(DEFAULT_TICKET_SORT.field),
  order: z
    .enum(SORT_ORDER, { error: "Invalid sort order" })
    .default(DEFAULT_TICKET_SORT.order),
  status: z
    .enum(TICKET_STATUS, { error: "Invalid status filter" })
    .optional(),
  category: z
    .enum([...Object.values(TICKET_CATEGORY), CATEGORY_NONE], {
      error: "Invalid category filter",
    })
    .optional(),
  // A user id, or `none` for tickets nobody owns. Unlike the two filters above
  // this can't be an enum — the values are rows in the user table — so only the
  // shape is checked here and an id matching nobody is a valid filter that
  // returns nothing. That is the honest answer for a shared link naming someone
  // who has since been deleted, and it leaks nothing: the same empty page comes
  // back for an id that never existed.
  assignedTo: z
    .string({ error: "Invalid assignee filter" })
    .trim()
    .min(1, "Invalid assignee filter")
    .max(ASSIGNEE_ID_MAX_LENGTH, "Invalid assignee filter")
    .optional(),
  q: z
    .string()
    .trim()
    .max(
      TICKET_SEARCH_MAX_LENGTH,
      `Search is limited to ${TICKET_SEARCH_MAX_LENGTH} characters`,
    )
    .optional(),
  // Query params arrive as strings, hence coerce. A non-numeric value becomes
  // NaN and fails `int()`, so it is rejected rather than silently defaulted.
  page: z.coerce
    .number({ error: "Invalid page" })
    .int("Invalid page")
    .min(FIRST_PAGE, "Invalid page")
    .default(FIRST_PAGE),
  pageSize: z.coerce
    .number({ error: "Invalid page size" })
    .int("Invalid page size")
    .min(1, "Invalid page size")
    .max(MAX_PAGE_SIZE, `Page size cannot exceed ${MAX_PAGE_SIZE}`)
    .default(DEFAULT_PAGE_SIZE),
});

export type TicketsQuery = z.infer<typeof ticketsQuerySchema>;

/**
 * Path params for GET /api/tickets/:id.
 *
 * Express hands `:id` over as a string, hence coerce — a non-numeric value
 * becomes NaN and fails `int()`. Every failure mode carries the same message
 * on purpose: a malformed id is a bad *request*, and there is nothing the
 * client could do differently for "abc" versus "-1".
 *
 * The upper bound is load-bearing rather than decoration. Without it an id past
 * int4 reaches Prisma, which throws on the conversion, and Express turns that
 * into a 500 for what is plainly a bad URL.
 */
export const ticketIdParamSchema = z.object({
  id: z.coerce
    .number({ error: "Invalid ticket id" })
    .int("Invalid ticket id")
    .min(1, "Invalid ticket id")
    .max(MAX_TICKET_ID, "Invalid ticket id"),
});

export type TicketIdParam = z.infer<typeof ticketIdParamSchema>;

/**
 * Body for PATCH /api/tickets/:id/assignee.
 *
 * `null` is the way to unassign, so the field is nullable but *required*: an
 * empty body is a mistake, and answering it with 200 and no change would hide
 * the mistake. Every failure mode shares one message — the client picks from a
 * list the server sent it, so a bad value here is a bug, not something a user
 * can correct by rewording. Whether the id belongs to a real, assignable user
 * is a database question, answered by the route.
 */
export const assignTicketSchema = z.object({
  assignedToId: z
    .string({ error: "Invalid assignee" })
    .trim()
    .min(1, "Invalid assignee")
    .max(ASSIGNEE_ID_MAX_LENGTH, "Invalid assignee")
    .nullable(),
});

export type AssignTicketValues = z.infer<typeof assignTicketSchema>;

/**
 * Body for PATCH /api/tickets/:id/status.
 *
 * Not nullable, unlike the two fields beside it: the column is non-null with a
 * default, so every ticket is in one of these states and there is nothing to
 * clear it to.
 */
export const updateTicketStatusSchema = z.object({
  status: z.enum(TICKET_STATUS, { error: "Invalid status" }),
});

export type UpdateTicketStatusValues = z.infer<typeof updateTicketStatusSchema>;

/**
 * Body for PATCH /api/tickets/:id/category.
 *
 * Nullable because a ticket genuinely can have no category — that is the state
 * every ticket arrives in, before anyone (or the classifier) has filed it, so
 * `null` has to be reachable again rather than being a one-way door.
 *
 * Note this takes a real `null`, not the `none` sentinel the list filter uses:
 * that one exists because a query string can't carry a null, and a JSON body
 * can.
 */
export const updateTicketCategorySchema = z.object({
  category: z.enum(TICKET_CATEGORY, { error: "Invalid category" }).nullable(),
});

export type UpdateTicketCategoryValues = z.infer<
  typeof updateTicketCategorySchema
>;

/**
 * Body for POST /api/tickets/:id/messages.
 *
 * Trimmed before it is measured, so a reply of five spaces is empty rather than
 * five characters long — and the trimmed value is what the route writes, so the
 * thread never carries leading blank lines nobody typed.
 *
 * Both failure modes are worded for a person, unlike `assignTicketSchema`'s one
 * opaque message: this field is free text an agent typed, so a rejection is
 * something they can act on rather than a client bug.
 */
export const createTicketMessageSchema = z.object({
  textBody: z
    .string({ error: "Write a reply before sending" })
    .trim()
    .min(1, "Write a reply before sending")
    .max(
      MAX_MESSAGE_BODY_LENGTH,
      `A reply is limited to ${MAX_MESSAGE_BODY_LENGTH} characters`,
    ),
});

export type CreateTicketMessageValues = z.infer<
  typeof createTicketMessageSchema
>;

/**
 * Query params for GET /api/tickets/stats.
 *
 * Both default, so a bare `/api/tickets/stats` is the dashboard's resting state
 * and the URL only ever carries what was actually chosen.
 *
 * There is deliberately no `userId`: `scope=mine` means the session's own id,
 * resolved server-side, so the endpoint can't be pointed at a colleague by
 * editing the query string.
 */
export const ticketStatsQuerySchema = z.object({
  range: z
    .enum(DASHBOARD_RANGE, { error: "Invalid range" })
    .default(DEFAULT_DASHBOARD_RANGE),
  scope: z
    .enum(DASHBOARD_SCOPE, { error: "Invalid scope" })
    .default(DASHBOARD_SCOPE.all),
});

export type TicketStatsQuery = z.infer<typeof ticketStatsQuerySchema>;
