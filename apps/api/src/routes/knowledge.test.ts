/**
 * Unit tests for `apps/api/src/routes/knowledge.ts`'s approval gate: the
 * routes on top of the pending-revision schema from #23 — submit, approve,
 * reject — and the rule that decides which edits need a second admin at all.
 *
 * The router only, on a real Express app over a real socket — and, since #170,
 * over a real database: `../db` is still replaced, but what it is replaced
 * *with* is a genuine Prisma client on a genuine Postgres running inside this
 * process (`../test/pg`, ADR-0014). The two hand-written tables that used to
 * stand in for `knowledge_article` and `knowledge_article_revision` are gone,
 * and three things they could not do are now what this file rests on:
 *
 *   - **The article and its revision commit together, or not at all.** Every
 *     write here is a `$transaction` (ADR-0006), and a fake `$transaction` that
 *     calls its callback cannot tell a committed write from a rolled-back one —
 *     it had already mutated the array by the time anything threw. See the
 *     rollback test at the end of the PATCH block.
 *   - **The conditional `updateMany` on `status: pending` is matched by
 *     Postgres**, so "approving twice 409s" tests the route's `where` clause
 *     rather than a `findIndex` written twenty lines above the assertion.
 *   - **Foreign keys are real.** `editorId` and `approvedById` point at `user`,
 *     so the admins these tests act as have to exist — hence `seedColleagues`,
 *     and hence the headers being derived from the seeded rows rather than
 *     invented beside them.
 *
 * `../middleware/auth` is still stubbed, and the `fakeGuard` here is
 * **deliberately identical** to the one in `./ai.test.ts` and
 * `../automation.test.ts` — `mock.module` registrations are process-global, so
 * a stub that disagreed about where the identity comes from would make one
 * file's tests pass alone and fail in the suite.
 *
 * What is *not* here: the `Restrict` that makes an article undeletable and the
 * `SetNull` that keeps the editor's name after their account goes. Postgres
 * enforces those, not this router, so they live in `../schema.test.ts`.
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
  KNOWLEDGE_REVISION_ACTION,
  KNOWLEDGE_REVISION_STATUS,
  TICKET_CATEGORY,
  type KnowledgeArticleEditResponse,
  type KnowledgeArticleRevision,
  type KnowledgeRevisionApprovalResponse,
  type KnowledgeRevisionRejectionResponse,
} from "@ticket/shared";
import { Prisma, prisma, resetDb } from "../test/pg";
import { COLLEAGUE, seedColleagues } from "../test/fixtures";

/* ── The world behind the router ─────────────────────────────────────────── */

mock.module("../db", () => ({ Prisma, prisma }));

/**
 * Deliberately identical to `./ai.test.ts` and `../automation.test.ts` — see
 * the file header.
 */
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

const { knowledgeRouter } = await import("./knowledge");

/* ── Fixtures ────────────────────────────────────────────────────────────── */

/**
 * The two admins the gate needs. Headers are read off the seeded rows rather
 * than written out again: `editorId` and `approvedById` are foreign keys, so a
 * header and a row that drifted apart would fail as a constraint violation in
 * whichever test wrote first, not as the identity mix-up it actually is.
 */
function headersFor(who: { id: string; name: string; email: string }) {
  return {
    "x-test-user": who.id,
    "x-test-agent-name": who.name,
    "x-test-user-email": who.email,
  };
}

const ADMIN_A = headersFor(COLLEAGUE.admin);
const ADMIN_B = headersFor(COLLEAGUE.otherAdmin);

function seedArticle(
  id: string,
  overrides: Partial<{
    title: string;
    autoReply: boolean;
    archived: boolean;
  }> = {},
) {
  return prisma.knowledgeArticle.create({
    data: {
      id,
      title: "How do I reset my password?",
      category: TICKET_CATEGORY.Technical,
      body: "Use the 'forgot password' link on the sign-in page.",
      internalNote: null,
      autoReply: false,
      archived: false,
      ...overrides,
    },
  });
}

const EDIT_BODY = {
  title: "How do I reset my password? (updated)",
  category: TICKET_CATEGORY.Technical,
  body: "Use the 'forgot password' link. It sends a reset email.",
  internalNote: "",
  autoReply: false,
};

/** The live row, as the customer-facing corpus would read it. */
function articleRow(id: string) {
  return prisma.knowledgeArticle.findUnique({ where: { id } });
}

function revisionRows(articleId?: string) {
  return prisma.knowledgeArticleRevision.findMany({
    where: articleId ? { articleId } : {},
    orderBy: { id: "asc" },
  });
}

beforeEach(async () => {
  await resetDb();
  await seedColleagues("admin", "otherAdmin");
  await seedArticle("KB-001", { autoReply: false });
  await seedArticle("KB-002", { autoReply: true, title: "Refund policy" });
});

/* ── The app ─────────────────────────────────────────────────────────────── */

let server: Server;
let origin: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/knowledge-articles", knowledgeRouter);
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

function sendPatch(
  id: string,
  body: unknown,
  headers: Record<string, string> = ADMIN_A,
) {
  return fetch(`${origin}/api/knowledge-articles/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function patch<T>(
  id: string,
  body: unknown,
  headers: Record<string, string> = ADMIN_A,
): Promise<Sent<T>> {
  const res = await sendPatch(id, body, headers);
  return { status: res.status, body: (await res.json()) as Sent<T>["body"] };
}

async function post<T>(
  path: string,
  headers: Record<string, string> = ADMIN_A,
): Promise<Sent<T>> {
  const res = await fetch(`${origin}/api/knowledge-articles${path}`, {
    method: "POST",
    headers,
  });
  return { status: res.status, body: (await res.json()) as Sent<T>["body"] };
}

/* ── PATCH /:id — the approval gate ─────────────────────────────────────── */

describe("PATCH /api/knowledge-articles/:id", () => {
  test("an edit to an article that is not, and will not be, auto-reply applies immediately", async () => {
    const sent = await patch<KnowledgeArticleEditResponse>(
      "KB-001",
      EDIT_BODY,
    );

    expect(sent.status).toBe(200);
    expect(sent.body.pendingRevision).toBeNull();
    expect(sent.body.article).toMatchObject({ title: EDIT_BODY.title });
    expect(await articleRow("KB-001")).toMatchObject({
      title: EDIT_BODY.title,
    });
    // The audit row committed with the article, which is the invariant the
    // whole table exists for: there is no path to `knowledge_article` that
    // does not also write a revision.
    expect(await revisionRows("KB-001")).toMatchObject([
      {
        action: KNOWLEDGE_REVISION_ACTION.updated,
        status: KNOWLEDGE_REVISION_STATUS.approved,
        title: EDIT_BODY.title,
        editorId: COLLEAGUE.admin.id,
        editorName: COLLEAGUE.admin.name,
      },
    ]);
  });

  test("an edit to an article already flagged auto-reply is held for a second admin", async () => {
    const sent = await patch<KnowledgeArticleEditResponse>("KB-002", {
      ...EDIT_BODY,
      autoReply: true,
    });

    expect(sent.status).toBe(202);
    // Nothing customer-visible moved: the live row is untouched.
    expect(sent.body.article.title).toBe("Refund policy");
    expect(await articleRow("KB-002")).toMatchObject({
      title: "Refund policy",
    });
    expect(sent.body.pendingRevision).toMatchObject({
      status: KNOWLEDGE_REVISION_STATUS.pending,
      title: EDIT_BODY.title,
    });
  });

  test("turning autoReply on is itself the risky edit, and is held too", async () => {
    const sent = await patch<KnowledgeArticleEditResponse>("KB-001", {
      ...EDIT_BODY,
      autoReply: true,
    });

    expect(sent.status).toBe(202);
    expect(await articleRow("KB-001")).toMatchObject({ autoReply: false });
    expect(sent.body.pendingRevision?.autoReply).toBe(true);
  });

  test("refuses a second proposal while one is already pending", async () => {
    await patch("KB-002", { ...EDIT_BODY, autoReply: true });
    const second = await patch("KB-002", {
      ...EDIT_BODY,
      title: "Another try",
      autoReply: true,
    });

    expect(second.status).toBe(409);
    expect(await revisionRows("KB-002")).toHaveLength(1);
  });

  test("still refuses to edit an archived article outright, gated or not", async () => {
    await prisma.knowledgeArticle.update({
      where: { id: "KB-002" },
      data: { archived: true },
    });

    const sent = await patch("KB-002", { ...EDIT_BODY, autoReply: true });

    expect(sent.status).toBe(409);
    expect(await revisionRows()).toHaveLength(0);
  });

  test("a revision that cannot be written takes the article edit back with it", async () => {
    // The editor's account is gone — the session outlived the row it names.
    // `editorId` is a foreign key, so the revision insert is refused *after*
    // the article update has already run inside the same transaction. This is
    // the assertion no fake `$transaction` could make: the old in-memory table
    // had been mutated by the time anything threw, so a rollback and a commit
    // looked exactly alike.
    //
    // A green run therefore prints one `prisma:error … Foreign key constraint
    // violated on … knowledge_article_revision_editorId_fkey`. That line is
    // this test working, not a failure that got through.
    const res = await sendPatch("KB-001", EDIT_BODY, {
      "x-test-user": "u_deleted",
      "x-test-agent-name": "Gone Admin",
      "x-test-user-email": "gone@example.com",
    });

    expect(res.status).toBe(500);
    expect(await articleRow("KB-001")).toMatchObject({
      title: "How do I reset my password?",
    });
    expect(await revisionRows()).toHaveLength(0);
  });
});

/* ── POST /:id/revisions/:revisionId/approve ────────────────────────────── */

describe("POST /api/knowledge-articles/:id/revisions/:revisionId/approve", () => {
  async function submitPending(): Promise<number> {
    const sent = await patch<KnowledgeArticleEditResponse>(
      "KB-002",
      { ...EDIT_BODY, autoReply: true },
      ADMIN_A,
    );
    return (sent.body.pendingRevision as KnowledgeArticleRevision).id;
  }

  test("an admin cannot approve their own pending revision", async () => {
    const revisionId = await submitPending();

    const sent = await post(
      `/KB-002/revisions/${revisionId}/approve`,
      ADMIN_A,
    );

    expect(sent.status).toBe(403);
    expect(await articleRow("KB-002")).toMatchObject({
      title: "Refund policy",
    });
    expect(
      await prisma.knowledgeArticleRevision.findUnique({
        where: { id: revisionId },
      }),
    ).toMatchObject({ status: KNOWLEDGE_REVISION_STATUS.pending });
  });

  test("a second admin approving copies the revision onto the live article", async () => {
    const revisionId = await submitPending();

    const sent = await post<KnowledgeRevisionApprovalResponse>(
      `/KB-002/revisions/${revisionId}/approve`,
      ADMIN_B,
    );

    expect(sent.status).toBe(200);
    expect(sent.body.article).toMatchObject({ title: EDIT_BODY.title });
    expect(sent.body.revision).toMatchObject({
      status: KNOWLEDGE_REVISION_STATUS.approved,
      approvedByName: COLLEAGUE.otherAdmin.name,
    });

    // Both halves of the transaction, read back out of the database rather
    // than out of the response: the live article carries the new text, and
    // the revision that put it there is closed out to the admin who approved
    // it. Either one without the other is the failure this step exists to
    // make impossible.
    expect(await articleRow("KB-002")).toMatchObject({
      title: EDIT_BODY.title,
      body: EDIT_BODY.body,
      autoReply: true,
    });
    expect(
      await prisma.knowledgeArticleRevision.findUnique({
        where: { id: revisionId },
      }),
    ).toMatchObject({
      status: KNOWLEDGE_REVISION_STATUS.approved,
      approvedById: COLLEAGUE.otherAdmin.id,
      approvedByName: COLLEAGUE.otherAdmin.name,
    });
  });

  test("approving an already-resolved revision 409s instead of double-applying", async () => {
    const revisionId = await submitPending();
    await post(`/KB-002/revisions/${revisionId}/approve`, ADMIN_B);
    await prisma.knowledgeArticle.update({
      where: { id: "KB-002" },
      data: { title: "Edited after approval" },
    });

    const second = await post(
      `/KB-002/revisions/${revisionId}/approve`,
      ADMIN_B,
    );

    expect(second.status).toBe(409);
    // The conditional `updateMany` on `status: pending` matched nothing the
    // second time, so the live article kept the later edit rather than having
    // the revision applied over the top of it.
    expect(await articleRow("KB-002")).toMatchObject({
      title: "Edited after approval",
    });
  });

  test("404s a revision id that does not belong to the article in the URL", async () => {
    const revisionId = await submitPending();

    const sent = await post(
      `/KB-001/revisions/${revisionId}/approve`,
      ADMIN_B,
    );

    expect(sent.status).toBe(404);
  });
});

/* ── POST /:id/revisions/:revisionId/reject ─────────────────────────────── */

describe("POST /api/knowledge-articles/:id/revisions/:revisionId/reject", () => {
  async function submitPending(): Promise<number> {
    const sent = await patch<KnowledgeArticleEditResponse>(
      "KB-002",
      { ...EDIT_BODY, autoReply: true },
      ADMIN_A,
    );
    return (sent.body.pendingRevision as KnowledgeArticleRevision).id;
  }

  test("a second admin rejecting leaves the live article untouched", async () => {
    const revisionId = await submitPending();

    const sent = await post<KnowledgeRevisionRejectionResponse>(
      `/KB-002/revisions/${revisionId}/reject`,
      ADMIN_B,
    );

    expect(sent.status).toBe(200);
    expect(sent.body.revision.status).toBe(KNOWLEDGE_REVISION_STATUS.rejected);
    expect(await articleRow("KB-002")).toMatchObject({
      title: "Refund policy",
      autoReply: true,
    });
    // Turned down, not deleted — nothing in this router removes a row.
    expect(await revisionRows("KB-002")).toHaveLength(1);
  });

  test("an admin may reject their own proposal — only approval is self-restricted", async () => {
    const revisionId = await submitPending();

    const sent = await post(
      `/KB-002/revisions/${revisionId}/reject`,
      ADMIN_A,
    );

    expect(sent.status).toBe(200);
  });

  test("rejecting an already-resolved revision 409s", async () => {
    const revisionId = await submitPending();
    await post(`/KB-002/revisions/${revisionId}/reject`, ADMIN_B);

    const second = await post(
      `/KB-002/revisions/${revisionId}/reject`,
      ADMIN_B,
    );

    expect(second.status).toBe(409);
  });
});

/* ── GET /pending-revisions — the review queue ──────────────────────────── */

describe("GET /api/knowledge-articles/pending-revisions", () => {
  function pendingRevisions(headers: Record<string, string> = ADMIN_A) {
    return fetch(`${origin}/api/knowledge-articles/pending-revisions`, {
      headers,
    });
  }

  test("lists only what is still pending, oldest first", async () => {
    // KB-001's proposal is the older one and is written directly, so the
    // ordering under test is `createdAt` rather than the order the two
    // requests happened to arrive in.
    await prisma.knowledgeArticleRevision.create({
      data: {
        articleId: "KB-001",
        action: KNOWLEDGE_REVISION_ACTION.updated,
        title: "An older proposal",
        category: TICKET_CATEGORY.Technical,
        body: "Turn autoReply on for this one.",
        internalNote: null,
        autoReply: true,
        archived: false,
        status: KNOWLEDGE_REVISION_STATUS.pending,
        editorId: COLLEAGUE.admin.id,
        editorName: COLLEAGUE.admin.name,
        editorEmail: COLLEAGUE.admin.email,
        createdAt: new Date("2026-08-23T12:00:00.000Z"),
      },
    });
    await patch("KB-002", { ...EDIT_BODY, autoReply: true }, ADMIN_A);

    const res = await pendingRevisions();
    const body = (await res.json()) as {
      revisions: KnowledgeArticleRevision[];
    };

    expect(res.status).toBe(200);
    expect(body.revisions.map((r) => r.articleId)).toEqual([
      "KB-001",
      "KB-002",
    ]);
    expect(body.revisions[0]).toMatchObject({
      title: "An older proposal",
      status: KNOWLEDGE_REVISION_STATUS.pending,
    });
  });

  test("drops a revision from the queue once it is resolved", async () => {
    const submitted = await patch<KnowledgeArticleEditResponse>(
      "KB-002",
      { ...EDIT_BODY, autoReply: true },
      ADMIN_A,
    );
    const revisionId = (
      submitted.body.pendingRevision as KnowledgeArticleRevision
    ).id;
    await post(`/KB-002/revisions/${revisionId}/reject`, ADMIN_B);

    const body = (await (await pendingRevisions()).json()) as {
      revisions: KnowledgeArticleRevision[];
    };

    expect(body.revisions).toEqual([]);
  });
});
