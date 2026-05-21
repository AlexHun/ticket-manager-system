import { Router } from "express";
import type { Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { createUserSchema } from "@ticket/core";
import type {
  CreateUserResponse,
  UserRole,
  UsersListResponse,
} from "@ticket/shared";
import { auth } from "../auth";
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

usersRouter.post(
  "/",
  requireAdmin,
  async (
    req: Request,
    res: Response<CreateUserResponse | { error: string }>,
  ) => {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    const { name, email, password } = parsed.data;

    const { user } = await auth.api.createUser({
      body: { name, email, password },
      headers: fromNodeHeaders(req.headers),
    });

    res.status(201).json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role as UserRole,
        emailVerified: user.emailVerified,
        createdAt: new Date(user.createdAt).toISOString(),
      },
    });
  },
);
