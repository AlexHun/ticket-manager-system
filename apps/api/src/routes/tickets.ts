import { Router } from "express";
import type { Request, Response } from "express";
import { ticketsQuerySchema } from "@ticket/core";
import {
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
    const { sort, order } = parsed.data;

    const tickets = await prisma.ticket.findMany({
      // `id` breaks ties so the order stays stable across requests. It matters
      // most for status/category, where whole groups of rows share a value.
      orderBy: [ORDER_BY[sort](order), { id: "desc" }],
    });

    res.json({
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
