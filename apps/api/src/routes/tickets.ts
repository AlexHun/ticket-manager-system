import { Router } from "express";
import type { Request, Response } from "express";
import type { TicketsListResponse } from "@ticket/shared";
import { prisma } from "../db";
import { requireAuth } from "../middleware/auth";

export const ticketsRouter = Router();

// Both roles work tickets, so this is requireAuth (not requireAdmin).
ticketsRouter.get(
  "/",
  requireAuth,
  async (_req: Request, res: Response<TicketsListResponse>) => {
    const tickets = await prisma.ticket.findMany({
      // Newest first. `id` breaks ties so the order stays stable when several
      // tickets share a createdAt (the webhook can ingest a batch in one tick).
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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
