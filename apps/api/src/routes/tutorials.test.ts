/**
 * Unit tests for `apps/api/src/routes/tutorials.ts`.
 *
 * The router only, on a real Express app over a real socket, with the
 * database replaced by a small in-memory table — same shape as
 * `knowledge.test.ts` and `automation.test.ts` (see `testing.md`). The
 * `../middleware/auth` stub is deliberately identical to theirs, for the
 * reason explained in their headers: `mock.module` registrations are
 * process-wide, and a stub that disagreed about where the identity comes
 * from would make one file's tests pass alone and fail in the suite.
 *
 * What's worth pinning down without a real database: the "missing row reads
 * as no content" default, `shouldShow`'s version comparison, that marking a
 * page seen actually stops it from showing again, and that an admin edit
 * neither needs nor creates a `TutorialProgress` row for anyone.
 */

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { NextFunction, Request, Response } from "express";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import express from "express";
import {
  TUTORIAL_PAGE_KEYS,
  type TutorialContentResponse,
  type TutorialContentsResponse,
  type TutorialStatusResponse,
} from "@ticket/shared";

/* ── The world behind the router ─────────────────────────────────────────── */

interface ContentRow {
  pageKey: string;
  title: string;
  steps: unknown;
  updatedAt: Date;
  updatedById: string | null;
  updatedByName: string | null;
}

interface ProgressRow {
  userId: string;
  pageKey: string;
  seenVersion: number;
  seenAt: Date;
}

let contents: ContentRow[];
let progress: ProgressRow[];

const NOW = new Date("2026-08-24T12:00:00.000Z");

const contentFindMany = mock(() => Promise.resolve(contents));

const contentFindUnique = mock((args: { where: { pageKey: string } }) =>
  Promise.resolve(contents.find((c) => c.pageKey === args.where.pageKey) ?? null),
);

const contentUpsert = mock(
  (args: {
    where: { pageKey: string };
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }) => {
    const idx = contents.findIndex((c) => c.pageKey === args.where.pageKey);
    if (idx === -1) {
      const row: ContentRow = {
        pageKey: args.create.pageKey as string,
        title: args.create.title as string,
        steps: args.create.steps,
        updatedAt: NOW,
        updatedById: (args.create.updatedById as string | null) ?? null,
        updatedByName: (args.create.updatedByName as string | null) ?? null,
      };
      contents.push(row);
      return Promise.resolve(row);
    }
    const updated: ContentRow = {
      ...contents[idx]!,
      ...args.update,
      updatedAt: NOW,
    } as ContentRow;
    contents[idx] = updated;
    return Promise.resolve(updated);
  },
);

const progressFindUnique = mock(
  (args: { where: { userId_pageKey: { userId: string; pageKey: string } } }) => {
    const { userId, pageKey } = args.where.userId_pageKey;
    return Promise.resolve(
      progress.find((p) => p.userId === userId && p.pageKey === pageKey) ??
        null,
    );
  },
);

const progressUpsert = mock(
  (args: {
    where: { userId_pageKey: { userId: string; pageKey: string } };
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }) => {
    const { userId, pageKey } = args.where.userId_pageKey;
    const idx = progress.findIndex(
      (p) => p.userId === userId && p.pageKey === pageKey,
    );
    if (idx === -1) {
      const row: ProgressRow = {
        userId,
        pageKey,
        seenVersion: args.create.seenVersion as number,
        seenAt: NOW,
      };
      progress.push(row);
      return Promise.resolve(row);
    }
    const updated: ProgressRow = {
      ...progress[idx]!,
      ...args.update,
    } as ProgressRow;
    progress[idx] = updated;
    return Promise.resolve(updated);
  },
);

mock.module("../db", () => ({
  prisma: {
    tutorialContent: {
      findMany: contentFindMany,
      findUnique: contentFindUnique,
      upsert: contentUpsert,
    },
    tutorialProgress: {
      findUnique: progressFindUnique,
      upsert: progressUpsert,
    },
  },
}));

/** Deliberately identical to `knowledge.test.ts` / `automation.test.ts` — see
 *  this file's header comment. */
const fakeGuard = (req: Request, res: Response, next: NextFunction) => {
  res.locals.session = {
    user: {
      id: req.header("x-test-user") ?? "agent-1",
      name: req.header("x-test-agent-name") ?? "Aaron Agent",
      email: req.header("x-test-user-email") ?? "agent@example.com",
    },
    session: { id: req.header("x-test-session") ?? "sess-1" },
  };
  next();
};

mock.module("../middleware/auth", () => ({
  requireAuth: fakeGuard,
  requireAdmin: fakeGuard,
  sessionOf: (res: Response) => res.locals.session,
}));

const { tutorialsRouter } = await import("./tutorials");

/* ── Fixtures ────────────────────────────────────────────────────────────── */

const AGENT = {
  "x-test-user": "u_agent",
  "x-test-agent-name": "Aaron Agent",
  "x-test-user-email": "agent@example.com",
};

const ADMIN = {
  "x-test-user": "u_admin",
  "x-test-agent-name": "Ada Admin",
  "x-test-user-email": "ada@example.com",
};

const CONTENT_BODY = {
  title: "Welcome to the dashboard",
  steps: [{ title: "Filters", body: "Use the range picker up top." }],
};

beforeEach(() => {
  contents = [];
  progress = [];
  contentFindMany.mockClear();
  contentFindUnique.mockClear();
  contentUpsert.mockClear();
  progressFindUnique.mockClear();
  progressUpsert.mockClear();
});

/* ── The app ─────────────────────────────────────────────────────────────── */

let server: Server;
let origin: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/tutorials", tutorialsRouter);
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

interface Sent<T> {
  status: number;
  body: T & { error?: string };
}

async function get<T>(
  path: string,
  headers: Record<string, string> = AGENT,
): Promise<Sent<T>> {
  const res = await fetch(`${origin}/api/tutorials${path}`, { headers });
  return { status: res.status, body: (await res.json()) as Sent<T>["body"] };
}

async function post<T>(
  path: string,
  headers: Record<string, string> = AGENT,
): Promise<Sent<T>> {
  const res = await fetch(`${origin}/api/tutorials${path}`, {
    method: "POST",
    headers,
  });
  return { status: res.status, body: (await res.json()) as Sent<T>["body"] };
}

async function put<T>(
  path: string,
  body: unknown,
  headers: Record<string, string> = ADMIN,
): Promise<Sent<T>> {
  const res = await fetch(`${origin}/api/tutorials${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Sent<T>["body"] };
}

/* ── GET /:pageKey ───────────────────────────────────────────────────────── */

describe("GET /api/tutorials/:pageKey", () => {
  test("a page nobody has authored content for reads as empty, and never shows", async () => {
    const sent = await get<TutorialStatusResponse>("/dashboard");

    expect(sent.status).toBe(200);
    expect(sent.body.tutorial.content.steps).toEqual([]);
    expect(sent.body.tutorial.shouldShow).toBe(false);
  });

  test("content with no progress row shows", async () => {
    await put("/dashboard", CONTENT_BODY);

    const sent = await get<TutorialStatusResponse>("/dashboard");

    expect(sent.body.tutorial.content).toMatchObject({
      title: CONTENT_BODY.title,
      steps: CONTENT_BODY.steps,
    });
    expect(sent.body.tutorial.shouldShow).toBe(true);
  });

  test("does not show again once marked seen at the current version", async () => {
    await put("/dashboard", CONTENT_BODY);
    await post("/dashboard/seen");

    const sent = await get<TutorialStatusResponse>("/dashboard");

    expect(sent.body.tutorial.shouldShow).toBe(false);
  });

  test("shows again for a progress row behind the current version", async () => {
    await put("/dashboard", CONTENT_BODY);
    progress.push({
      userId: "u_agent",
      pageKey: "dashboard",
      seenVersion: 0,
      seenAt: NOW,
    });

    const sent = await get<TutorialStatusResponse>("/dashboard");

    expect(sent.body.tutorial.shouldShow).toBe(true);
  });

  test("is per user: one agent's seen mark doesn't hide it from another", async () => {
    await put("/dashboard", CONTENT_BODY);
    await post("/dashboard/seen", AGENT);

    const sent = await get<TutorialStatusResponse>("/dashboard", ADMIN);

    expect(sent.body.tutorial.shouldShow).toBe(true);
  });

  test("404s an unknown page key", async () => {
    const sent = await get("/not-a-real-page");
    expect(sent.status).toBe(404);
  });
});

/* ── POST /:pageKey/seen ─────────────────────────────────────────────────── */

describe("POST /api/tutorials/:pageKey/seen", () => {
  test("creates a progress row on first dismissal", async () => {
    const sent = await post("/dashboard/seen");

    expect(sent.status).toBe(200);
    expect(progress).toContainEqual(
      expect.objectContaining({ userId: "u_agent", pageKey: "dashboard" }),
    );
  });

  test("404s an unknown page key", async () => {
    const sent = await post("/not-a-real-page/seen");
    expect(sent.status).toBe(404);
  });
});

/* ── GET /  (admin list) ─────────────────────────────────────────────────── */

describe("GET /api/tutorials", () => {
  test("lists every page, defaulted where nobody has written content", async () => {
    await put("/dashboard", CONTENT_BODY);

    const sent = await get<TutorialContentsResponse>("/", ADMIN);

    expect(sent.status).toBe(200);
    expect(sent.body.tutorials).toHaveLength(TUTORIAL_PAGE_KEYS.length);
    expect(
      sent.body.tutorials.find((t) => t.pageKey === "dashboard"),
    ).toMatchObject({ title: CONTENT_BODY.title });
    expect(
      sent.body.tutorials.find((t) => t.pageKey === "tickets"),
    ).toMatchObject({ title: "", steps: [] });
  });
});

/* ── PUT /:pageKey ───────────────────────────────────────────────────────── */

describe("PUT /api/tutorials/:pageKey", () => {
  test("creates content and records who wrote it", async () => {
    const sent = await put<TutorialContentResponse>("/dashboard", CONTENT_BODY);

    expect(sent.status).toBe(200);
    expect(sent.body.tutorial).toMatchObject({
      title: CONTENT_BODY.title,
      steps: CONTENT_BODY.steps,
      updatedByName: "Ada Admin",
    });
  });

  test("editing content does not touch anyone's progress", async () => {
    await put("/dashboard", CONTENT_BODY);
    await post("/dashboard/seen");
    expect(progress).toHaveLength(1);

    await put("/dashboard", { ...CONTENT_BODY, title: "Welcome (updated)" });

    expect(progress).toHaveLength(1);
    expect(progress[0]?.seenVersion).toBe(1);
  });

  test("rejects a tutorial with no steps", async () => {
    const sent = await put("/dashboard", { ...CONTENT_BODY, steps: [] });
    expect(sent.status).toBe(400);
    expect(contents).toHaveLength(0);
  });

  test("404s an unknown page key", async () => {
    const sent = await put("/not-a-real-page", CONTENT_BODY);
    expect(sent.status).toBe(404);
  });
});
