/**
 * Unit tests for `apps/api/src/routes/tutorials.ts`.
 *
 * The router only, on a real Express app over a real socket — and, since #169,
 * over a real database: `../db` is still replaced, but what it is replaced
 * *with* is a genuine Prisma client on a genuine Postgres running inside this
 * process (`../test/pg`, ADR-0014). The two hand-written tables that used to
 * live here — `tutorialContent` and `tutorialProgress` — are gone, so the
 * `@@unique([userId, pageKey])` behind `/seen`, the `pageKey` enum, and the
 * `updatedById` foreign key onto the editor are all Postgres' own answers now.
 *
 * The `../middleware/auth` stub is deliberately identical to
 * `knowledge.test.ts`'s and `automation.test.ts`'s, for the reason explained
 * in their headers: `mock.module` registrations are process-wide, and a stub
 * that disagreed about where the identity comes from would make one file's
 * tests pass alone and fail in the suite.
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
  TUTORIAL_PAGE_VERSIONS,
  type TutorialContentResponse,
  type TutorialContentsResponse,
  type TutorialPageKey,
  type TutorialStatusResponse,
} from "@ticket/shared";
import { Prisma, prisma, resetDb } from "../test/pg";
import { COLLEAGUE, seedColleagues } from "../test/fixtures";

/* ── The world behind the router ─────────────────────────────────────────── */

const NOW = new Date("2026-08-24T12:00:00.000Z");

mock.module("../db", () => ({ Prisma, prisma }));

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
  "x-test-user": COLLEAGUE.agent.id,
  "x-test-agent-name": COLLEAGUE.agent.name,
  "x-test-user-email": COLLEAGUE.agent.email,
};

const ADMIN = {
  "x-test-user": COLLEAGUE.admin.id,
  "x-test-agent-name": COLLEAGUE.admin.name,
  "x-test-user-email": COLLEAGUE.admin.email,
};

const CONTENT_BODY = {
  title: "Welcome to the dashboard",
  steps: [{ title: "Filters", body: "Use the range picker up top." }],
};

const DASHBOARD: TutorialPageKey = "dashboard";

/** `TutorialProgress.userId` and `TutorialContent.updatedById` are both
 *  foreign keys, so both callers have to be real colleagues — which is itself
 *  something the old fakes could not have told us. */
beforeEach(async () => {
  await resetDb();
  await seedColleagues("agent", "admin");
});

/** Insert a progress row directly, for the "already behind" case. */
function seedProgressRow(
  userId: string,
  pageKey: TutorialPageKey,
  seenVersion: number,
) {
  return prisma.tutorialProgress.create({
    data: { userId, pageKey, seenVersion, seenAt: NOW },
  });
}

/** Read the progress rows back, ignoring the autoincrement id. */
function progressRows() {
  return prisma.tutorialProgress.findMany({
    select: { userId: true, pageKey: true, seenVersion: true },
    orderBy: [{ userId: "asc" }, { pageKey: "asc" }],
  });
}

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
    await seedProgressRow("u_agent", DASHBOARD, 0);

    const sent = await get<TutorialStatusResponse>("/dashboard");

    expect(sent.body.tutorial.shouldShow).toBe(true);
  });

  test("is per user: one agent's seen mark doesn't hide it from another", async () => {
    await put("/dashboard", CONTENT_BODY);
    await post("/dashboard/seen", AGENT);

    const sent = await get<TutorialStatusResponse>("/dashboard", ADMIN);

    expect(sent.body.tutorial.shouldShow).toBe(true);
  });

  test("one page's content is not another page's", async () => {
    // The old fake matched `pageKey` with `===` on a string it had stored
    // itself; this is Postgres matching the enum column the route selects on.
    await put("/dashboard", CONTENT_BODY);

    const sent = await get<TutorialStatusResponse>("/tickets");

    expect(sent.body.tutorial.content.steps).toEqual([]);
    expect(sent.body.tutorial.shouldShow).toBe(false);
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
    expect(await progressRows()).toEqual([
      {
        userId: "u_agent",
        pageKey: DASHBOARD,
        seenVersion: TUTORIAL_PAGE_VERSIONS[DASHBOARD],
      },
    ]);
  });

  test("updates rather than duplicates on a second dismissal", async () => {
    // `@@unique([userId, pageKey])` is what makes this an update, and it is
    // now the constraint deciding rather than a `findIndex` in this file.
    await seedProgressRow("u_agent", DASHBOARD, 0);

    await post("/dashboard/seen");

    expect(await progressRows()).toEqual([
      {
        userId: "u_agent",
        pageKey: DASHBOARD,
        seenVersion: TUTORIAL_PAGE_VERSIONS[DASHBOARD],
      },
    ]);
  });

  test("404s an unknown page key", async () => {
    const sent = await post("/not-a-real-page/seen");
    expect(sent.status).toBe(404);
    expect(await progressRows()).toEqual([]);
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
    expect(
      await prisma.tutorialContent.findUniqueOrThrow({
        where: { pageKey: DASHBOARD },
        select: {
          title: true,
          steps: true,
          updatedById: true,
          updatedByName: true,
        },
      }),
    ).toEqual({
      title: CONTENT_BODY.title,
      steps: CONTENT_BODY.steps,
      updatedById: "u_admin",
      updatedByName: "Ada Admin",
    });
  });

  // What happens to `updatedById` once that editor's account is deleted is
  // the schema's rule, not this route's — it lives in `../schema.test.ts`.

  test("editing content does not touch anyone's progress", async () => {
    await put("/dashboard", CONTENT_BODY);
    await post("/dashboard/seen");

    await put("/dashboard", { ...CONTENT_BODY, title: "Welcome (updated)" });

    expect(await progressRows()).toEqual([
      {
        userId: "u_agent",
        pageKey: DASHBOARD,
        seenVersion: TUTORIAL_PAGE_VERSIONS[DASHBOARD],
      },
    ]);
  });

  test("rejects a tutorial with no steps", async () => {
    const sent = await put("/dashboard", { ...CONTENT_BODY, steps: [] });
    expect(sent.status).toBe(400);
    expect(await prisma.tutorialContent.count()).toBe(0);
  });

  test("404s an unknown page key", async () => {
    const sent = await put("/not-a-real-page", CONTENT_BODY);
    expect(sent.status).toBe(404);
  });
});
