import { Router } from "express";
import type { Request, Response } from "express";
import type { UsersListResponse } from "@ticket/shared";
import { prisma } from "../db";
import { requireAdmin } from "../middleware/auth";

export const usersRouter = Router();

usersRouter.get(
  "/",
  requireAdmin,
  async (_req: Request, res: Response<UsersListResponse>) => {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        emailVerified: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });

    res.json({
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        emailVerified: u.emailVerified,
        createdAt: u.createdAt.toISOString(),
      })),
    });
  },
);
