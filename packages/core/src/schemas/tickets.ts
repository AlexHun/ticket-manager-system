import { z } from "zod";
import {
  AGENT_SETTABLE_STATUS,
  CATEGORY_NONE,
  CLIENT_TICKET_STATUS,
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
  STATUS_BACKLOG,
  TICKET_CATEGORY,
  TICKET_SEARCH_MAX_LENGTH,
  TICKET_SORT_FIELD,
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
  // Every status except `Processing`, which the list refuses to return at all.
  // Rejecting it is kinder than accepting it: a filter that always yields an
  // empty page looks like a broken query, and this way the client is told.
  //
  // Plus `STATUS_BACKLOG`, which is not a status but a set — `New` and `Open`
  // together. It is the one filter the list could not previously express and the
  // one every "not dealt with" number on the dashboard means, so every link from
  // such a number now lands on exactly the tickets it counted.
  status: z
    .enum([...CLIENT_TICKET_STATUS, STATUS_BACKLOG], {
      error: "Invalid status filter",
    })
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
 *
 * `AGENT_SETTABLE_STATUS` rather than the whole enum, and that narrowing is the
 * enforcement rather than a convenience for the picker. `Processing` is a claim
 * a background worker holds, and a request that could set it by hand could hide
 * any ticket from every agent indefinitely — there is nothing to release it. The
 * UI offering three options is downstream of this, not a substitute for it.
 */
export const updateTicketStatusSchema = z.object({
  status: z.enum(AGENT_SETTABLE_STATUS, { error: "Invalid status" }),
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
  /**
   * The polished draft this reply was sent from, when Polish produced the text
   * still in the box — or text since hand-edited from it. Optional and absent
   * on anything that was never polished, or that undid its polish before
   * sending: those are indistinguishable from a draft that never touched
   * Polish, which is the honest reading of "the agent typed this".
   *
   * Same cap as `textBody`: this started as a reply the composer already
   * accepted, so a tighter bound here would reject text the box already holds.
   */
  polishedDraft: z
    .string()
    .trim()
    .min(1)
    .max(MAX_MESSAGE_BODY_LENGTH)
    .optional(),
});

export type CreateTicketMessageValues = z.infer<
  typeof createTicketMessageSchema
>;

/**
 * Body for POST /api/ai/polish-reply.
 *
 * Its own schema rather than a reuse of `createTicketMessageSchema`, for two
 * reasons that both show up in the UI: the field is `draft`, not `textBody`,
 * because nothing here is written to the thread, and "before sending" is the
 * wrong sentence to put in front of a button that does not send.
 *
 * The cap is deliberately the same one, though. A lower ceiling would save a
 * fraction of a cent and buy a state where a reply can be sent but not polished
 * — a button refusing work the button beside it accepts, for a reason no agent
 * can see.
 *
 * `ticketId` is how the rewrite knows what it is answering. It is the id and
 * *not* the customer's message itself: the server reads that text out of the
 * thread it already owns, so a client cannot decide what the model is told the
 * customer said. Required rather than optional — the composer always knows the
 * ticket it is sitting in, and an optional field would let a caller quietly fall
 * back to the context-free rewrite this schema used to describe.
 */
export const polishReplySchema = z.object({
  draft: z
    .string({ error: "Write a draft before polishing" })
    .trim()
    .min(1, "Write a draft before polishing")
    .max(
      MAX_MESSAGE_BODY_LENGTH,
      `A draft is limited to ${MAX_MESSAGE_BODY_LENGTH} characters`,
    ),
  // Reused from the path-param schema rather than restated, so the two cannot
  // drift on what counts as a ticket id — including the int4 ceiling that keeps
  // an oversized number from reaching Prisma and becoming a 500.
  ticketId: ticketIdParamSchema.shape.id,
});

export type PolishReplyValues = z.infer<typeof polishReplySchema>;

/**
 * Body for POST /api/ai/summarize-ticket.
 *
 * One field, and that is the design rather than an oversight. Everything the
 * summary is built from — the subject, the customer, every message in the thread
 * — is read server-side from the ticket this id names. None of it is accepted
 * from the caller, for the reason spelled out on `polishReplySchema`: the thread
 * is written by strangers and ends up in a prompt, so the only copy that reaches
 * the model is the one in our own database.
 *
 * There is deliberately no field for length, tone or focus. A summary the client
 * can steer is a prompt the client can write.
 */
export const summarizeTicketSchema = z.object({
  ticketId: ticketIdParamSchema.shape.id,
});

export type SummarizeTicketValues = z.infer<typeof summarizeTicketSchema>;

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

/**
 * Query params for GET /api/tickets/effectiveness.
 *
 * `range` only — no `scope`. This panel answers "is the assistant helping",
 * a system-wide question with no "mine" reading: the assistant is not an
 * agent, and `categoryOverride` is about tickets the classifier touched, not
 * about which agent is signed in.
 */
export const ticketEffectivenessQuerySchema = z.object({
  range: z
    .enum(DASHBOARD_RANGE, { error: "Invalid range" })
    .default(DEFAULT_DASHBOARD_RANGE),
});

export type TicketEffectivenessQuery = z.infer<
  typeof ticketEffectivenessQuerySchema
>;
