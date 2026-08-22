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
  asAutoReplyDecline,
  BACKLOG_STATUS,
  CATEGORY_NONE,
  STATUS_BACKLOG,
  TICKET_SORT_FIELD,
  TICKET_STATUS,
  TICKET_VIEWS,
  ticketViewParams,
  type CreateTicketMessageResponse,
  type SortOrder,
  type TicketActivityResponse,
  type TicketAssigneesResponse,
  type TicketDetailResponse,
  type TicketSortField,
  type TicketsListResponse,
  type TicketView,
  type TicketViewCountsResponse,
  type TicketWithAssignee,
  type UpdateTicketResponse,
} from "@ticket/shared";
import { prisma, type Prisma } from "../db";
import {
  publishTicketChanges,
  publishTicketMessage,
} from "../events/ticket-events";
import { requireAuth, sessionOf } from "../middleware/auth";
import {
  MESSAGE_SELECT,
  REPLY_ORIGIN,
  SEND_OUTCOME,
  sendReply,
} from "../outbound";
import {
  agentActor,
  ticketChanges,
  writeActivity,
  type TicketFields,
} from "../ticket-activity";
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
  // Backed by the `@@index([lastMessageAt])` already on the model, which was
  // added for the customer panels rather than for this — but it is the same
  // column and the same ordering, so the list's default sort costs no new index.
  [TICKET_SORT_FIELD.lastMessageAt]: (order) => ({ lastMessageAt: order }),
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

  // `backlog` is the one status value that names a set rather than a status, so
  // it is the one that has to be resolved here — see `STATUS_BACKLOG`. This is
  // the single place it turns into statuses, which is what lets the saved views
  // count through this function and be certain of matching the page they link to.
  if (query.status) {
    where.status =
      query.status === STATUS_BACKLOG
        ? { in: [...BACKLOG_STATUS] }
        : query.status;
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
 *
 * The assistant is excluded, and that is the one narrowing here that is about
 * meaning rather than access. Assigning a ticket is asking somebody to deal
 * with it; the assistant deals with a ticket exactly once, unattended, at the
 * moment it arrives, and has no way to be asked again. It reaches the column
 * from the other side — `jobs/auto-reply-ticket.ts` files a ticket under it
 * after answering — so a ticket can *show* the assistant as its assignee while
 * nobody can *choose* it. Because this predicate builds the picker and validates
 * what comes back, both halves are settled by the one line.
 */
const ASSIGNABLE_USER = {
  deletedAt: null,
  automated: false,
} satisfies Prisma.UserWhereInput;

/** The columns an assignee is described by — never role, ban state or the rest. */
const ASSIGNEE_SELECT = { id: true, name: true, email: true } as const;

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

/** The three mutable fields as the audit trail stores them: display strings. */
function fieldsOf(ticket: {
  status: string;
  category: string | null;
  assignedTo: { name: string } | null;
}): TicketFields {
  return {
    status: ticket.status,
    category: ticket.category,
    assignee: ticket.assignedTo?.name ?? null,
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
 * It now also reads the values being replaced, because an audit entry is a
 * *transition* and the previous value is gone the moment the update lands.
 *
 * Update and entry share one transaction, the way every write to a knowledge
 * article shares one with its revision (`routes/knowledge.ts`). The trail is
 * only worth reading if it cannot disagree with the row it describes.
 */
async function updateTicket(
  id: number,
  data: Prisma.TicketUncheckedUpdateInput,
  res: Response<UpdateTicketResponse | { error: string }>,
): Promise<void> {
  const existing = await prisma.ticket.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      category: true,
      assignedTo: { select: { name: true } },
    },
  });
  if (!existing) {
    res.status(404).json({ error: "Ticket not found" });
    return;
  }

  const actor = agentActor(sessionOf(res).user);

  const { ticket, changes } = await prisma.$transaction(async (tx) => {
    const updated = await tx.ticket.update({
      where: { id },
      data,
      include: { assignedTo: { select: ASSIGNEE_SELECT } },
    });

    // Diffed rather than read off `data`, which is the difference between
    // recording what changed and recording what was submitted. A PATCH setting
    // the status a ticket already has writes nothing — an agent pressing Save
    // twice has not changed anything, and a trail that says otherwise teaches
    // people to distrust it.
    const entries = ticketChanges(fieldsOf(existing), fieldsOf(updated));
    for (const entry of entries) {
      await writeActivity(tx, id, entry, actor);
    }

    return { ticket: updated, changes: entries };
  });

  // Outside the transaction on purpose — the rule for every publish in this
  // codebase. An event says "re-read this", and one published before the commit
  // could be acted on by a colleague's tab that then reads the old row, caches
  // it, and is never told again.
  //
  // Driven by the same array the trail was written from, so the two cannot
  // disagree about what moved, and so a PATCH that changed nothing stays silent
  // on the channel exactly as it stays absent from the trail.
  publishTicketChanges(id, changes);

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

/**
 * How many tickets are behind each saved view in the sidebar.
 *
 * The counting is deliberately indirect: every view is turned into the same
 * query params the sidebar puts in its `href`, parsed by the same schema
 * `GET /api/tickets` parses, and narrowed by the same `buildWhere`. Nothing here
 * knows what "unassigned" means — `ticketViewParams` does, once, for both ends.
 * That is what makes a badge and the page it links to incapable of disagreeing,
 * which two shipped bugs in this app had already managed the other way round.
 *
 * `parse`, not `safeParse`: the input is our own table rather than the request,
 * so a rejection means the views and the list API have come apart and a 500 is
 * the honest answer. There is no client mistake to report.
 *
 * One transaction so the four numbers are a single snapshot — otherwise a ticket
 * assigned between two of them could leave the sidebar showing more unassigned
 * tickets than there are tickets in the backlog.
 */
ticketsRouter.get(
  "/views",
  requireAuth,
  async (_req: Request, res: Response<TicketViewCountsResponse>) => {
    const session = sessionOf(res);

    const totals = await prisma.$transaction(
      TICKET_VIEWS.map((view) =>
        prisma.ticket.count({
          where: buildWhere(
            ticketsQuerySchema.parse(ticketViewParams(view, session.user.id)),
          ),
        }),
      ),
    );

    // `TICKET_VIEWS` is every view, so the record is total — but
    // `Object.fromEntries` types its result as a partial map and cannot know
    // that. The cast is the only thing standing in for it.
    const counts = Object.fromEntries(
      TICKET_VIEWS.map((view, i) => [view, totals[i]]),
    ) as Record<TicketView, number>;

    res.json({ counts });
  },
);

// Route order: any future literal child route (`/export`) has to be registered
// ABOVE this one, or `:id` will swallow it — which is why `/assignees`, `/stats`
// and `/views` sit above. Registered below, `/stats` reaches
// `ticketIdParamSchema`, which answers `400 Invalid ticket id` and sends you
// looking in the wrong place.
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
        // Validated on the way out rather than trusted. The column is a plain
        // string, so a value written by an older build, a hand-edited row or a
        // reason since renamed would otherwise reach the client as a key the UI
        // has no wording for. Unrecognised reads as null — "nothing to report" —
        // which is what an unknown verdict honestly is.
        autoReplyDecline: asAutoReplyDecline(ticket.autoReplyDecline),
        autoReplyDeclinedAt: ticket.autoReplyDeclinedAt?.toISOString() ?? null,
      },
    });
  },
);

/**
 * The ticket's audit trail, oldest first.
 *
 * A sub-resource rather than a field on `GET /:id`, following
 * `/knowledge/:id/revisions`, and for a second reason of its own: the trail
 * changes at different moments than the thread does. Every status and assignee
 * mutation on the detail page adds to it while leaving the messages untouched,
 * so a client holding it separately refetches the short list instead of the
 * ticket and its whole conversation.
 *
 * `requireAuth`, not `requireAdmin`: both roles work tickets, and an agent who
 * can see a ticket can already see its status and who it belongs to. What this
 * adds is when those became true and who made them so.
 *
 * No pagination. A ticket accumulates a handful of these over its life — unlike
 * a knowledge article, which is edited indefinitely — and the whole point is to
 * read it in one piece against the thread beside it.
 */
ticketsRouter.get(
  "/:id/activity",
  requireAuth,
  async (req: Request, res: Response<TicketActivityResponse | { error: string }>) => {
    const parsed = ticketIdParamSchema.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }

    // No existence check. An empty trail is the honest answer for a ticket that
    // predates this feature, and it is indistinguishable from one that never
    // moved — so 404-ing on a missing ticket would buy nothing but a second
    // query on every read.
    const activity = await prisma.ticketActivity.findMany({
      where: { ticketId: parsed.data.id },
      // `id` breaks ties: entries written in the same transaction share an
      // instant, and a reopen that also reassigns must read in that order.
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        action: true,
        fromValue: true,
        toValue: true,
        actorKind: true,
        actorName: true,
        createdAt: true,
      },
    });

    res.json({
      activity: activity.map((entry) => ({
        ...entry,
        createdAt: entry.createdAt.toISOString(),
      })),
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

    const { user } = sessionOf(res);

    // Everything that is true of any reply leaving the desk — the id, the
    // parent it threads onto, the direction, the ticket's last-message time —
    // belongs to `outbound.ts`, which the auto-reply writes through too. What
    // is left here is what is genuinely this route's: the session the sender
    // comes from, the 404, and the shape of the response.
    const sent = await sendReply({
      ticketId: params.data.id,
      textBody: body.data.textBody,
      // From the session, never the body: the sender is whoever is signed in.
      origin: {
        kind: REPLY_ORIGIN.agent,
        author: user,
        polishedDraft: body.data.polishedDraft,
      },
    });

    // A missing ticket is a 404, and the module answers it rather than throwing
    // — an insert allowed to fail on the foreign key would come back through
    // the error pipeline as a 500.
    if (sent.outcome === SEND_OUTCOME.noSuchTicket) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }
    const { message } = sent;

    // No status side-effect, so no `ticket_updated` — but `lastMessageAt` moved,
    // which reorders any list sorted by it. That is the list's problem to
    // re-read, not something to describe in the event.
    //
    // The sending tab receives this too and will refetch a thread it has already
    // appended to. `appendMessage` in `TicketReplyComposer` dedupes by message
    // id — a guard written for background refetches that covers this unchanged —
    // so the cost is one indexed read, and suppressing it would mean a
    // connection id on every mutation to save exactly that.
    publishTicketMessage(message.ticketId);

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
