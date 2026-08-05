import { Router } from "express";
import type { Request, Response } from "express";
import { ticketsQuerySchema, type TicketsQuery } from "@ticket/core";
import {
  CATEGORY_NONE,
  TICKET_SORT_FIELD,
  type SortOrder,
  type TicketSortField,
  type TicketsListResponse,
} from "@ticket/shared";
import { prisma, type Prisma } from "../db";
import { requireAuth } from "../middleware/auth";

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
  [TICKET_SORT_FIELD.createdAt]: (order) => ({ createdAt: order }),
};

/**
 * Absent filters mean "don't narrow on this field", so each one is only added
 * when present. `category=none` is the one value that can't be passed straight
 * through — it maps to SQL NULL rather than to a category.
 */
function buildWhere(query: TicketsQuery): Prisma.TicketWhereInput {
  const where: Prisma.TicketWhereInput = {};

  if (query.status) {
    where.status = query.status;
  }

  if (query.category) {
    where.category =
      query.category === CATEGORY_NONE ? null : query.category;
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
        // `id` breaks ties so the order stays stable across requests. It matters
        // most for status/category, where whole groups of rows share a value,
        // and paging an unstable order would repeat or skip rows.
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
      tickets: tickets.map((t) => ({
        id: t.id,
        subject: t.subject,
        status: t.status,
        category: t.category,
        customerEmail: t.customerEmail,
        customerName: t.customerName,
        assignedToId: t.assignedToId,
        lastMessageAt: t.lastMessageAt.toISOString(),
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })),
    });
  },
);
