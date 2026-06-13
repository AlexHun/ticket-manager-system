import { Router } from "express";
import type { Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import type { z, ZodType } from "zod";
import { createUserSchema, updateUserSchema } from "@ticket/core";
import type {
  CreateUserResponse,
  UpdateUserResponse,
  UserRole,
  UsersListResponse,
} from "@ticket/shared";
import { auth } from "../auth";
import { prisma } from "../db";
import { requireAdmin } from "../middleware/auth";

function parseBody<S extends ZodType>(
  schema: S,
  req: Request,
  res: Response,
): z.infer<S> | null {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return null;
  }
  return parsed.data;
}

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
    const data = parseBody(createUserSchema, req, res);
    if (!data) return;
    const { name, email, password } = data;

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

usersRouter.patch(
  "/:id",
  requireAdmin,
  async (
    req: Request,
    res: Response<UpdateUserResponse | { error: string }>,
  ) => {
    const data = parseBody(updateUserSchema, req, res);
    if (!data) return;

    const { name, email, password } = data;
    
    const userId = req.params.id as string;
    const headers = fromNodeHeaders(req.headers);

    await auth.api.adminUpdateUser({
      body: { userId, data: { name, email } },
      headers,
    });

    if (password && password.length > 0) {
      await auth.api.setUserPassword({
        body: { userId, newPassword: password },
        headers,
      });
    }

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        emailVerified: true,
        createdAt: true,
      },
    });

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role as UserRole,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt.toISOString(),
      },
    });
  },
);
