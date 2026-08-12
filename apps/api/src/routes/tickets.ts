import { Router } from "express";
import type { Request, Response } from "express";
import {
  assignTicketSchema,
  createTicketMessageSchema,
  ticketIdParamSchema,
  ticketsQuerySchema,
  updateTicketCategorySchema,
  updateTicketStatusSchema,
  type TicketsQuery,
} from "@ticket/core";
import {
  ASSIGNEE_NONE,
  CATEGORY_NONE,
  MESSAGE_DIRECTION,
  TICKET_SORT_FIELD,
  TICKET_STATUS,
  type CreateTicketMessageResponse,
  type SortOrder,
  type TicketAssigneesResponse,
  type TicketDetailResponse,
  type TicketSortField,
  type TicketsListResponse,
  type TicketWithAssignee,
  type UpdateTicketResponse,
} from "@ticket/shared";
import { prisma, type Prisma } from "../db";
import { newOutboundMessageId } from "../message-id";
import { requireAuth, sessionOf } from "../middleware/auth";
import { ticketStatsHandler } from "./ticket-stats";

/**
 * Every sortable column maps to a hand-written Prisma orderBy, so the client's
 * `sort` string only ever *selects* a builder — it is never spliced into the
 * query. The Record also makes adding a sort field a compile error until it is
 * mapped here.
 */
const ORDER_BY: Record<
  TicketSortField,
  (order: SortOrder) => Prisma.TicketOrderByWithRelationInput
> = {
  [TICKET_SORT_FIELD.subject]: (order) => ({ subject: order }),
  [TICKET_SORT_FIELD.customerName]: (order) => ({ customerName: order }),
  [TICKET_SORT_FIELD.status]: (order) => ({ status: order }),
  // category is nullable — keep uncategorised tickets at the bottom either way,
  // rather than letting a pile of NULLs head the list on one of the directions.
  [TICKET_SORT_FIELD.category]: (order) => ({
    category: { sort: order, nulls: "last" },
  }),
  // By the assignee's name, through the relation — `assignedToId` is a cuid and
  // would order by nothing anyone can see.
  //
  // Unlike category above, unassigned tickets are *not* pinned to the bottom:
  // `nulls` is only accepted on a nullable scalar, and what is nullable here is
  // the relation, not `user.name`. So this takes Postgres' default placement —
  // unassigned last ascending, first descending. Pinning them would mean
  // ordering on `assignedToId` first, and since a cuid is unique that key alone
  // would decide the whole order and the name would never be consulted.
  [TICKET_SORT_FIELD.assignedTo]: (order) => ({
    assignedTo: { name: order },
  }),
  [TICKET_SORT_FIELD.createdAt]: (order) => ({ createdAt: order }),
};

/**
 * Absent filters mean "don't narrow on this field", so each one is only added
 * when present. `category=none` and `assignedTo=none` are the two values that
 * can't be passed straight through — each maps to SQL NULL rather than to a
 * category or a user.
 *
 * One clause is not a filter at all and cannot be turned off: `Processing` is
 * never returned. A ticket in that status is claimed by a worker composing a
 * reply for it, and the reason it is hidden is that an agent who opens it and
 * answers would send the customer a second reply written by somebody else. It
 * lasts seconds. `CLIENT_TICKET_STATUS` keeps the value out of the filter schema
 * too, so nobody can ask for the empty page this would otherwise produce.
 */
function buildWhere(query: TicketsQuery): Prisma.TicketWhereInput {
  // In `AND`, deliberately. The free-text search below owns `where.OR` at this
  // level, and expressing this as a second `OR` would replace it — the filter
  // would silently stop narrowing and every search would return the whole table.
  const where: Prisma.TicketWhereInput = {
    AND: [{ status: { not: TICKET_STATUS.Processing } }],
  };

  if (query.status) {
    where.status = query.status;
  }

  if (query.category) {
    where.category =
      query.category === CATEGORY_NONE ? null : query.category;
  }

  // Matched on the id, not through the relation: `assignedToId` is on the
  // ticket row, so "nobody" is a plain IS NULL and an owner is an equality on a
  // column that is already indexed by the foreign key.
  //
  // The id is not checked against the user table first. An unknown one narrows
  // to nothing, which is what a filter naming a deleted colleague should show —
  // and it keeps this off the path of a request that would otherwise probe which
  // ids exist by the difference between "no tickets" and "no such user".
  if (query.assignedTo) {
    where.assignedToId =
      query.assignedTo === ASSIGNEE_NONE ? null : query.assignedTo;
  }

  // Free-text search spans the columns an agent would recognise a ticket by.
  // Trimmed by the schema, so an all-whitespace search is already "".
  if (query.q) {
    where.OR = [
      { subject: { contains: query.q, mode: "insensitive" } },
      { customerName: { contains: query.q, mode: "insensitive" } },
      { customerEmail: { contains: query.q, mode: "insensitive" } },
    ];
  }

  return where;
}

/**
 * Who a ticket may be handed to: every active user, whatever their role.
 * Admins work tickets alongside agents, so role doesn't narrow this.
 *
 * One definition, used both to build the picker and to validate what comes
 * back from it — otherwise the two drift and the UI offers a choice the API
 * refuses.
 *
 * Deleting a user is a soft delete that also bans them, so `deletedAt` already
 * covers "can't sign in". If a standalone ban ever lands, this is the predicate
 * to extend.
 */
const ASSIGNABLE_USER = {
  deletedAt: null,
} satisfies Prisma.UserWhereInput;

/** The columns an assignee is described by — never role, ban state or the rest. */
const ASSIGNEE_SELECT = { id: true, name: true, email: true } as const;

/**
 * The columns a `ThreadMessage` is made of.
 *
 * htmlBody is deliberately absent: it is attacker-supplied inbound email, and
 * anything that reaches the client is one innerHTML away from running as the
 * signed-in agent. The plain-text part is what the UI renders. authorId is
 * absent too — nothing in the thread shows it, and `senderName`/`senderEmail`
 * already say who wrote a reply. `automated` is here for the opposite reason:
 * the thread marks those, because "nobody wrote this" is exactly what an agent
 * reading a reply needs told rather than left to infer.
 *
 * Shared by the thread on `GET /:id` and the single message `POST /:id/messages`
 * answers with, so the two can't come to disagree about the shape of the same
 * thing.
 */
const MESSAGE_SELECT = {
  id: true,
  ticketId: true,
  messageId: true,
  inReplyTo: true,
  senderEmail: true,
  senderName: true,
  textBody: true,
  direction: true,
  automated: true,
  createdAt: true,
} as const;

/**
 * The row behind a `TicketWithAssignee`: the same fields, still carrying `Date`
 * where the wire wants a string. Derived from the response type rather than
 * spelled out, so a field added to one is a compile error in the other.
 */
type TicketRow = Omit<
  TicketWithAssignee,
  "lastMessageAt" | "createdAt" | "updatedAt"
> & {
  lastMessageAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

/** One place the ticket's wire shape is written down, for every route that replies with one. */
function toTicketWithAssignee(ticket: TicketRow): TicketWithAssignee {
  return {
    id: ticket.id,
    subject: ticket.subject,
    status: ticket.status,
    category: ticket.category,
    customerEmail: ticket.customerEmail,
    customerName: ticket.customerName,
    assignedToId: ticket.assignedToId,
    assignedTo: ticket.assignedTo,
    lastMessageAt: ticket.lastMessageAt.toISOString(),
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
  };
}

/**
 * Write one field and reply with the whole ticket — the tail every PATCH below
 * shares. They differ only in what they validate and what they write; the reply
 * is the same either way, and carries no `messages`, because none of them touch
 * the thread and the client already has it.
 *
 * The existence check is a separate query rather than a catch around Prisma's
 * "record not found": a missing ticket is a 404, and letting the update throw
 * to say so would route a plainly bad id through the error pipeline as a 500.
 */
async function updateTicket(
  id: number,
  data: Prisma.TicketUncheckedUpdateInput,
  res: Response<UpdateTicketResponse | { error: string }>,
): Promise<void> {
  const existing = await prisma.ticket.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }

  const ticket = await prisma.ticket.update({
    where: { id },
    data,
    include: { assignedTo: { select: ASSIGNEE_SELECT } },
  });

  res.json({ ticket: toTicketWithAssignee(ticket) });
}

export const ticketsRouter = Router();

// Both roles work tickets, so this is requireAuth (not requireAdmin).
ticketsRouter.get(
  "/",
  requireAuth,
  async (
    req: Request,
    res: Response<TicketsListResponse | { error: string }>,
  ) => {
    const parsed = ticketsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { sort, order, page, pageSize } = parsed.data;
    const where = buildWhere(parsed.data);

    // One transaction so the count can't drift from the page beside it — a
    // ticket arriving between two separate queries would show a total that
    // disagrees with the rows.
    const [tickets, total] = await prisma.$transaction([
      prisma.ticket.findMany({
        where,
        // The list renders the assignee's name, so it is resolved here rather
        // than left as a cuid the client cannot look up. Same narrow select as
        // the detail view — a ticket list is not a window onto the user table.
        include: { assignedTo: { select: ASSIGNEE_SELECT } },
        // `id` breaks ties so the order stays stable across requests. It matters
        // most for status/category/assignee, where whole groups of rows share a
        // value, and paging an unstable order would repeat or skip rows.
        orderBy: [ORDER_BY[sort](order), { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.ticket.count({ where }),
    ]);

    res.json({
      total,
      page,
      pageSize,
      // The same shaper the detail route uses, so the two can't come to
      // disagree about how a ticket looks on the wire.
      tickets: tickets.map(toTicketWithAssignee),
    });
  },
);

/**
 * The users a ticket can be assigned to.
 *
 * Lives here rather than under `/api/users` so that everything on that path
 * stays admin-only: an agent needs to pick a colleague, not to read the user
 * table, and this returns only the three columns a picker shows.
 */
ticketsRouter.get(
  "/assignees",
  requireAuth,
  async (_req: Request, res: Response<TicketAssigneesResponse>) => {
    const assignees = await prisma.user.findMany({
      where: ASSIGNABLE_USER,
      select: ASSIGNEE_SELECT,
      // Name is what the picker is read by; id breaks ties so two people who
      // share a name don't swap places between requests.
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });

    res.json({ assignees });
  },
);

/**
 * Everything the dashboard draws, for one slice. Implementation lives in
 * `./ticket-stats` — it is ~300 lines of aggregation with nothing in common
 * with the CRUD above.
 *
 * `requireAuth`, not `requireAdmin`: both roles work tickets, and an agent can
 * already read every ticket through `GET /api/tickets`, so `scope=all` discloses
 * nothing new.
 */
ticketsRouter.get("/stats", requireAuth, ticketStatsHandler);

// Route order: any future literal child route (`/export`) has to be registered
// ABOVE this one, or `:id` will swallow it — which is why `/assignees` and
// `/stats` sit above. Registered below, `/stats` reaches `ticketIdParamSchema`,
// which answers `400 Invalid ticket id` and sends you looking in the wrong place.
ticketsRouter.get(
  "/:id",
  requireAuth,
  async (
    req: Request,
    res: Response<TicketDetailResponse | { error: string }>,
  ) => {
    // requireAuth already ran, so a signed-out request gets 401 whether or not
    // the ticket exists — the endpoint is not an oracle for which ids are real.
    const parsed = ticketIdParamSchema.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id: parsed.data.id },
      include: {
        // Only what the detail view shows. A ticket is not a window onto the
        // user table, so role and the rest stay behind.
        assignedTo: { select: ASSIGNEE_SELECT },
        messages: {
          select: MESSAGE_SELECT,
          // Oldest first — a thread reads top-down. `id` breaks ties because
          // createdAt defaults to now(), and a batch insert shares an instant.
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        },
      },
    });

    if (!ticket) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }

    res.json({
      ticket: {
        ...toTicketWithAssignee(ticket),
        // The select above already narrowed these to the wire shape; only the
        // date still needs converting.
        messages: ticket.messages.map((m) => ({
          ...m,
          createdAt: m.createdAt.toISOString(),
        })),
      },
    });
  },
);

/**
 * Append an agent's reply to a ticket's thread.
 *
 * Persistence only. The row is written the way an outbound email *would* be
 * recorded — a minted Message-ID, `In-Reply-To` pointing at whatever the thread
 * currently ends with — but nothing is handed to a mail provider. When a
 * transport does land it reads the row it finds here instead of needing the
 * headers reconstructed, which is the whole reason to get them right now.
 *
 * No status side-effect. Replying appends a message and moves `lastMessageAt`;
 * whether the ticket is resolved stays a judgement an agent makes with the
 * status picker. Inferring it from "someone answered" would close tickets that
 * were only being asked a follow-up question.
 *
 * A param route, so the ordering note above `GET /:id` doesn't apply to it —
 * that one is about *literal* children being swallowed by `:id`.
 *
 * `requireAuth` like everything else here, and the session is load-bearing for
 * once: the sender's name, address and id all come from it, never from the body.
 */
ticketsRouter.post(
  "/:id/messages",
  requireAuth,
  async (
    req: Request,
    res: Response<CreateTicketMessageResponse | { error: string }>,
  ) => {
    const params = ticketIdParamSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.issues[0].message });
      return;
    }

    // `?? {}` so a bodyless request fails on the missing field and gets the same
    // "Write a reply before sending" as an empty one.
    const body = createTicketMessageSchema.safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ error: body.error.issues[0].message });
      return;
    }

    // The existence check and the parent lookup are one query. The check is a
    // query rather than a catch around a foreign-key violation for the same
    // reason `updateTicket` does it that way: a missing ticket is a 404, and
    // letting the insert throw would route it through the error pipeline as a
    // 500.
    //
    // `take: 1` on the reverse of the thread's own ordering *is* its last
    // message — the same tie-break, so the parent is the one the agent can see
    // at the bottom of the pane. A ticket with no messages yet threads nothing
    // and gets a null, which is what a first email looks like anyway.
    const ticket = await prisma.ticket.findUnique({
      where: { id: params.data.id },
      select: {
        id: true,
        messages: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
          select: { messageId: true },
        },
      },
    });
    if (!ticket) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }

    const { user } = sessionOf(res);

    // One instant for both writes rather than two `now()` defaults a moment
    // apart. The client moves the ticket's "Last message" to the createdAt of
    // the message it gets back, and that is only true if the two columns were
    // written from the same value.
    const sentAt = new Date();

    const [message] = await prisma.$transaction([
      prisma.message.create({
        data: {
          ticketId: ticket.id,
          messageId: newOutboundMessageId(ticket.id),
          inReplyTo: ticket.messages[0]?.messageId ?? null,
          // From the session, never the body: the sender is whoever is signed
          // in. Denormalised beside `authorId` on purpose — deleting the agent
          // nulls the FK, and the thread still has to say who wrote this.
          senderEmail: user.email,
          senderName: user.name,
          textBody: body.data.textBody,
          // The column defaults to `inbound`, so this is not optional.
          direction: MESSAGE_DIRECTION.outbound,
          authorId: user.id,
          createdAt: sentAt,
        },
        select: MESSAGE_SELECT,
      }),
      prisma.ticket.update({
        where: { id: ticket.id },
        data: { lastMessageAt: sentAt },
        // Nothing reads the ticket back; without this Prisma returns every
        // column of a row the response doesn't carry.
        select: { id: true },
      }),
    ]);

    res.status(201).json({
      message: { ...message, createdAt: message.createdAt.toISOString() },
    });
  },
);

/**
 * Assign a ticket, or unassign it with `assignedToId: null`.
 *
 * One of three sub-resources rather than a general `PATCH /:id`: each route
 * writes exactly the field it is named after, so what a request may change is
 * decided by the URL and not by whichever keys a body happened to carry. A
 * route that took "whatever fields you send" would quietly grow into one that
 * can change anything.
 *
 * `requireAuth`, matching the rest of the tickets API — agents work tickets, so
 * they hand them to each other. Nothing here reads the caller's identity, so
 * the two roles behave identically.
 */
ticketsRouter.patch(
  "/:id/assignee",
  requireAuth,
  async (
    req: Request,
    res: Response<UpdateTicketResponse | { error: string }>,
  ) => {
    const params = ticketIdParamSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.issues[0].message });
      return;
    }

    // `?? {}` so a request with no body fails on the missing field and gets the
    // same "Invalid assignee" as a malformed one, rather than zod's phrasing
    // for a missing object.
    const body = assignTicketSchema.safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ error: body.error.issues[0].message });
      return;
    }
    const { assignedToId } = body.data;

    // The FK alone would accept any row in the user table — including someone
    // deleted since the picker was drawn. 400 rather than 404: the id in the
    // body is the part that isn't usable.
    //
    // Runs before the existence check inside `updateTicket`, so a request that
    // is wrong in both ways at once is answered "Assignee not found" rather
    // than "Ticket not found". Either is true; this one names the part the
    // client chose, and the ordering only shows up in that one case.
    if (assignedToId !== null) {
      const assignee = await prisma.user.findFirst({
        where: { ...ASSIGNABLE_USER, id: assignedToId },
        select: { id: true },
      });
      if (!assignee) {
        res.status(400).json({ error: "Assignee not found" });
        return;
      }
    }

    await updateTicket(params.data.id, { assignedToId }, res);
  },
);

/**
 * Move a ticket through its lifecycle: Open → Resolved → Closed, or back.
 *
 * No transition rules: the statuses are a label an agent applies, not a state
 * machine, and reopening something closed by mistake is a thing that has to
 * work. The enum in the schema is the only constraint.
 */
ticketsRouter.patch(
  "/:id/status",
  requireAuth,
  async (
    req: Request,
    res: Response<UpdateTicketResponse | { error: string }>,
  ) => {
    const params = ticketIdParamSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.issues[0].message });
      return;
    }

    const body = updateTicketStatusSchema.safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ error: body.error.issues[0].message });
      return;
    }

    await updateTicket(params.data.id, { status: body.data.status }, res);
  },
);

/**
 * File a ticket under a category, or clear it with `category: null`.
 *
 * Clearing is deliberately allowed: every ticket starts uncategorised, so a
 * wrong guess — an agent's or, later, the classifier's — has to be undoable to
 * the state it came from rather than only swappable for another wrong one.
 */
ticketsRouter.patch(
  "/:id/category",
  requireAuth,
  async (
    req: Request,
    res: Response<UpdateTicketResponse | { error: string }>,
  ) => {
    const params = ticketIdParamSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.issues[0].message });
      return;
    }

    const body = updateTicketCategorySchema.safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ error: body.error.issues[0].message });
      return;
    }

    await updateTicket(params.data.id, { category: body.data.category }, res);
  },
);
