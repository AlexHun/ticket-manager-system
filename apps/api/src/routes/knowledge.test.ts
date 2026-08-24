/**
 * Unit tests for `apps/api/src/routes/knowledge.ts`'s approval gate: the
 * routes on top of the pending-revision schema from #23 — submit, approve,
 * reject — and the rule that decides which edits need a second admin at all.
 *
 * The router only, on a real Express app over a real socket, with the
 * database replaced by a small in-memory table. `../db` and `../middleware/auth`
 * are the two mocks almost every route test needs (see `testing.md`); the
 * `fakeGuard` here is **deliberately identical** to the one in
 * `./ai.test.ts` and `../automation.test.ts` — `mock.module` registrations
 * are process-global, so a stub that disagreed about where the identity comes
 * from would make one file's tests pass alone and fail in the suite.
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
  KNOWLEDGE_REVISION_STATUS,
  TICKET_CATEGORY,
  type KnowledgeArticleEditResponse,
  type KnowledgeArticleRevision,
  type KnowledgeRevisionApprovalResponse,
  type KnowledgeRevisionRejectionResponse,
} from "@ticket/shared";

/* ── The world behind the router ─────────────────────────────────────────── */

interface ArticleRow {
  id: string;
  title: string;
  category: string;
  body: string;
  internalNote: string | null;
  autoReply: boolean;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface RevisionRow {
  id: number;
  articleId: string;
  action: string;
  title: string;
  category: string;
  body: string;
  internalNote: string | null;
  autoReply: boolean;
  archived: boolean;
  editorId: string | null;
  editorName: string;
  editorEmail: string | null;
  status: string;
  approvedById: string | null;
  approvedByName: string | null;
  approvedAt: Date | null;
  createdAt: Date;
}

let articles: ArticleRow[];
let revisions: RevisionRow[];
let nextRevisionId: number;

const NOW = new Date("2026-08-23T12:00:00.000Z");

const articleFindUnique = mock((args: { where: { id: string } }) =>
  Promise.resolve(articles.find((a) => a.id === args.where.id) ?? null),
);

const articleUpdate = mock(
  (args: { where: { id: string }; data: Record<string, unknown> }) => {
    const idx = articles.findIndex((a) => a.id === args.where.id);
    if (idx === -1) throw new Error("article not found in fake table");
    const updated = { ...articles[idx], ...args.data, updatedAt: NOW } as ArticleRow;
    articles[idx] = updated;
    return Promise.resolve(updated);
  },
);

const revisionFindFirst = mock(
  (args: { where: { articleId: string; status: string } }) =>
    Promise.resolve(
      revisions.find(
        (r) =>
          r.articleId === args.where.articleId &&
          r.status === args.where.status,
      ) ?? null,
    ),
);

const revisionFindUnique = mock((args: { where: { id: number } }) =>
  Promise.resolve(revisions.find((r) => r.id === args.where.id) ?? null),
);

const revisionFindUniqueOrThrow = mock((args: { where: { id: number } }) => {
  const found = revisions.find((r) => r.id === args.where.id);
  if (!found) throw new Error("revision not found in fake table");
  return Promise.resolve(found);
});

const revisionCreate = mock((args: { data: Record<string, unknown> }) => {
  const row: RevisionRow = {
    id: nextRevisionId++,
    articleId: args.data.articleId as string,
    action: args.data.action as string,
    title: args.data.title as string,
    category: args.data.category as string,
    body: args.data.body as string,
    internalNote: (args.data.internalNote as string | null) ?? null,
    autoReply: args.data.autoReply as boolean,
    archived: args.data.archived as boolean,
    editorId: (args.data.editorId as string | null) ?? null,
    editorName: args.data.editorName as string,
    editorEmail: (args.data.editorEmail as string | null) ?? null,
    // Mirrors the schema's `@default(approved)` — a create call that omits
    // `status` is exactly what an immediate, ungated write looks like.
    status: (args.data.status as string | undefined) ?? "approved",
    approvedById: null,
    approvedByName: null,
    approvedAt: null,
    createdAt: NOW,
  };
  revisions.push(row);
  return Promise.resolve(row);
});

const revisionFindMany = mock(
  (args: { where: { status: string }; orderBy: { createdAt: string } }) =>
    Promise.resolve(
      revisions
        .filter((r) => r.status === args.where.status)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    ),
);

const revisionUpdateMany = mock(
  (args: {
    where: { id: number; status: string };
    data: Record<string, unknown>;
  }) => {
    const idx = revisions.findIndex(
      (r) => r.id === args.where.id && r.status === args.where.status,
    );
    if (idx === -1) return Promise.resolve({ count: 0 });
    revisions[idx] = { ...revisions[idx], ...args.data } as RevisionRow;
    return Promise.resolve({ count: 1 });
  },
);

const client = {
  knowledgeArticle: { findUnique: articleFindUnique, update: articleUpdate },
  knowledgeArticleRevision: {
    findFirst: revisionFindFirst,
    findMany: revisionFindMany,
    findUnique: revisionFindUnique,
    findUniqueOrThrow: revisionFindUniqueOrThrow,
    create: revisionCreate,
    updateMany: revisionUpdateMany,
  },
};

mock.module("../db", () => ({
  prisma: {
    ...client,
    $transaction: (cb: (c: typeof client) => unknown) => cb(client),
  },
}));

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

const ADMIN_A = {
  "x-test-user": "u_admin_a",
  "x-test-agent-name": "Ada Admin",
  "x-test-user-email": "ada@example.com",
};

const ADMIN_B = {
  "x-test-user": "u_admin_b",
  "x-test-agent-name": "Bo Admin",
  "x-test-user-email": "bo@example.com",
};

function article(overrides: Partial<ArticleRow> & { id: string }): ArticleRow {
  return {
    title: "How do I reset my password?",
    category: TICKET_CATEGORY.Technical,
    body: "Use the 'forgot password' link on the sign-in page.",
    internalNote: null,
    autoReply: false,
    archived: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const EDIT_BODY = {
  title: "How do I reset my password? (updated)",
  category: TICKET_CATEGORY.Technical,
  body: "Use the 'forgot password' link. It sends a reset email.",
  internalNote: "",
  autoReply: false,
};

beforeEach(() => {
  articles = [
    article({ id: "KB-001", autoReply: false }),
    article({ id: "KB-002", autoReply: true, title: "Refund policy" }),
  ];
  revisions = [];
  nextRevisionId = 1;
  articleFindUnique.mockClear();
  articleUpdate.mockClear();
  revisionFindFirst.mockClear();
  revisionFindMany.mockClear();
  revisionFindUnique.mockClear();
  revisionFindUniqueOrThrow.mockClear();
  revisionCreate.mockClear();
  revisionUpdateMany.mockClear();
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

async function patch<T>(
  id: string,
  body: unknown,
  headers: Record<string, string> = ADMIN_A,
): Promise<Sent<T>> {
  const res = await fetch(`${origin}/api/knowledge-articles/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
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
    expect(articles.find((a) => a.id === "KB-001")).toMatchObject({
      title: EDIT_BODY.title,
    });
  });

  test("an edit to an article already flagged auto-reply is held for a second admin", async () => {
    const sent = await patch<KnowledgeArticleEditResponse>("KB-002", {
      ...EDIT_BODY,
      autoReply: true,
    });

    expect(sent.status).toBe(202);
    // Nothing customer-visible moved: the live row is untouched.
    expect(sent.body.article.title).toBe("Refund policy");
    expect(articles.find((a) => a.id === "KB-002")).toMatchObject({
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
    expect(articles.find((a) => a.id === "KB-001")).toMatchObject({
      autoReply: false,
    });
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
    expect(revisions.filter((r) => r.articleId === "KB-002")).toHaveLength(1);
  });

  test("still refuses to edit an archived article outright, gated or not", async () => {
    articles = articles.map((a) =>
      a.id === "KB-002" ? { ...a, archived: true } : a,
    );

    const sent = await patch("KB-002", { ...EDIT_BODY, autoReply: true });

    expect(sent.status).toBe(409);
    expect(revisions).toHaveLength(0);
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
    expect(articles.find((a) => a.id === "KB-002")).toMatchObject({
      title: "Refund policy",
    });
    expect(revisions.find((r) => r.id === revisionId)).toMatchObject({
      status: KNOWLEDGE_REVISION_STATUS.pending,
    });
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
      approvedByName: "Bo Admin",
    });
    expect(articles.find((a) => a.id === "KB-002")).toMatchObject({
      title: EDIT_BODY.title,
      autoReply: true,
    });
  });

  test("approving an already-resolved revision 409s instead of double-applying", async () => {
    const revisionId = await submitPending();
    await post(`/KB-002/revisions/${revisionId}/approve`, ADMIN_B);

    const second = await post(
      `/KB-002/revisions/${revisionId}/approve`,
      ADMIN_B,
    );

    expect(second.status).toBe(409);
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
    expect(articles.find((a) => a.id === "KB-002")).toMatchObject({
      title: "Refund policy",
      autoReply: true,
    });
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
  test("lists only what is still pending, oldest first", async () => {
    await patch("KB-002", { ...EDIT_BODY, autoReply: true }, ADMIN_A);
    const res = await fetch(
      `${origin}/api/knowledge-articles/pending-revisions`,
      { headers: ADMIN_A },
    );
    const body = (await res.json()) as {
      revisions: KnowledgeArticleRevision[];
    };

    expect(res.status).toBe(200);
    expect(body.revisions).toHaveLength(1);
    expect(body.revisions[0]).toMatchObject({
      articleId: "KB-002",
      status: KNOWLEDGE_REVISION_STATUS.pending,
    });
  });
});
