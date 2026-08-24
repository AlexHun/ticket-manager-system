import {
  expect,
  request as pwRequest,
  test,
  type APIRequestContext,
} from "@playwright/test";
import {
  KNOWLEDGE_REVISION_STATUS,
  MESSAGE_DIRECTION,
  TICKET_CATEGORY,
  TICKET_STATUS,
} from "@ticket/shared";
import { Role } from "../../apps/api/src/generated/prisma/client";
import { KNOWLEDGE_ARTICLE_MARKER } from "./fake-openai/constants";
import { CREDENTIALS } from "./helpers/auth";
import { E2E_EMAIL_PREFIX, resetE2eEmails, resetE2eUsers, testDb, waitForInvitationLink } from "./helpers/db";

/**
 * Issue #26 — the regression test for the whole #17/#23/#24/#25 chain: an
 * unapproved edit to an auto-replyable article must never reach a customer,
 * and the fix must survive without a restart.
 *
 * This is the one spec in the suite that runs the real, unattended pipeline —
 * ingest -> classify -> gate -> auto-reply -> resolve — end to end. Every other
 * spec runs against the ordinary :3002 server, which `.env.test` deliberately
 * leaves AI-disabled (no `OPENAI_API_KEY`, `AUTO_REPLY_ENABLED=false`) so that
 * their assertions about uncategorised, unresolved tickets stay true. Flipping
 * those switches suite-wide would make every one of those specs flaky.
 *
 * So this spec talks to a *second* API instance instead — `AI_API_URL` below,
 * booted by playwright.config.ts from `apps/api/.env.test.ai` on :3003 — with
 * AI switched on and `OPENAI_BASE_URL` redirected to the fake-OpenAI stub in
 * `./fake-openai`. Both servers share the one `ticket_manager_test` database,
 * which is only safe because `playwright.config.ts` runs with
 * `fullyParallel: false, workers: 1`: nothing else in the suite is writing
 * while this one runs.
 *
 * Pure `request`-level, no `page`/browser: approve/reject are plain
 * authenticated POSTs, already covered pixel-for-pixel by issue #25's
 * component tests, and the shared web app on :4001 has no route to :3003
 * (`VITE_API_URL` is baked in at build time). `pwRequest.newContext()` rather
 * than the per-test `request` fixture because Admin A's session has to survive
 * across several `test()` blocks in this `.serial` describe — the fixture
 * would hand back a fresh, cookie-less context every time.
 */

const AI_API_URL = "http://localhost:3003";
const ADMIN = CREDENTIALS.admin;

let localPartCounter = 0;
/** A `localPart` unique within this run — `simulateEmailSchema` requires lowercase. */
function nextLocalPart(): string {
  localPartCounter += 1;
  return `e2e-kb-${Date.now()}-${localPartCounter}`;
}

async function signIn(
  ctx: APIRequestContext,
  email: string,
  password: string,
): Promise<void> {
  const res = await ctx.post(`${AI_API_URL}/api/auth/sign-in/email`, {
    data: { email, password },
  });
  if (!res.ok()) {
    throw new Error(
      `Sign-in failed for ${email}: ${res.status()} ${await res.text()}`,
    );
  }
}

interface SimulateResult {
  ticketId: number;
  threaded: boolean;
}

async function simulateEmail(
  ctx: APIRequestContext,
  subject: string,
  textBody: string,
): Promise<SimulateResult> {
  const res = await ctx.post(`${AI_API_URL}/api/pipeline/simulate`, {
    data: {
      localPart: nextLocalPart(),
      senderName: "E2E KB Customer",
      subject,
      textBody,
      htmlBody: "",
      inReplyTo: "",
    },
  });
  if (res.status() !== 201) {
    throw new Error(
      `POST /api/pipeline/simulate failed: ${res.status()} ${await res.text()}`,
    );
  }
  return res.json();
}

/**
 * Poll the ticket row itself rather than any API response — the auto-reply
 * runs off pg-boss, asynchronously to the `simulate` call that enqueued it.
 * Mirrors the poll-until-timeout shape `waitForInvitationLink` already uses in
 * `helpers/db.ts`, against a different column.
 */
async function waitForAutoResolved(ticketId: number, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const ticket = await testDb.ticket.findUniqueOrThrow({
      where: { id: ticketId },
    });

    if (ticket.autoResolvedAt !== null) return ticket;

    // A ticket the auto-reply declined is back to `Open` with a reason — fail
    // fast with that reason rather than waiting out the full timeout on a
    // ticket that has already reached its terminal state.
    if (ticket.status === TICKET_STATUS.Open && ticket.autoReplyDecline) {
      throw new Error(
        `Ticket ${ticketId} was declined (${ticket.autoReplyDecline}) instead of auto-resolved`,
      );
    }

    if (Date.now() > deadline) {
      throw new Error(
        `Ticket ${ticketId} was not auto-resolved within ${timeoutMs}ms ` +
          `(status=${ticket.status}, category=${ticket.category})`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function latestOutboundMessage(ticketId: number) {
  return testDb.message.findFirstOrThrow({
    where: { ticketId, direction: MESSAGE_DIRECTION.outbound },
    orderBy: { id: "desc" },
  });
}

test.describe.serial("Knowledge-base auto-reply approval gate (real pipeline)", () => {
  const runId = Date.now();
  const articleTitle = "How do I reset the E2E test widget?";
  const originalBody = `${KNOWLEDGE_ARTICLE_MARKER} For run ${runId}: press and hold the button for ORIGINAL-${runId} seconds to reset the widget.`;
  const updatedBody = `${KNOWLEDGE_ARTICLE_MARKER} For run ${runId}: press and hold the button for UPDATED-${runId} seconds to reset the widget.`;

  const adminBEmail = `${E2E_EMAIL_PREFIX}kb-admin-b-${runId}@example.com`;
  const adminBName = "E2E KB Admin B";
  const adminBPassword = "password123";

  let adminACtx: APIRequestContext;
  let adminBCtx: APIRequestContext | undefined;
  let articleId: string;
  let pendingRevisionId: number;

  test.beforeAll(async () => {
    adminACtx = await pwRequest.newContext();
    await signIn(adminACtx, ADMIN.email, ADMIN.password);
  });

  test.afterAll(async () => {
    // Tidy the corpus back down rather than leaving an ever-growing pile of
    // auto-reply articles across repeated runs — archived articles drop out
    // of `autoReplyArticles()` entirely, so a future run's prompt (and the
    // fake-OpenAI stub's corpus parsing) stays small. Best-effort: a failure
    // here must not mask a real assertion failure above it.
    if (articleId) {
      await adminACtx
        .post(`${AI_API_URL}/api/knowledge-articles/${articleId}/archive`, {
          data: { archived: true },
        })
        .catch(() => {});
    }

    await adminACtx?.dispose();
    await adminBCtx?.dispose();

    await resetE2eUsers();
    await resetE2eEmails();
  });

  test("Admin A creates an auto-replyable article", async () => {
    const res = await adminACtx.post(`${AI_API_URL}/api/knowledge-articles`, {
      data: {
        title: articleTitle,
        category: TICKET_CATEGORY.General,
        body: originalBody,
        internalNote: "",
        autoReply: true,
      },
    });
    expect(res.status()).toBe(201);

    const { article } = await res.json();
    articleId = article.id;
    expect(article.body).toBe(originalBody);
    expect(article.autoReply).toBe(true);
  });

  test("a ticket the article covers is auto-resolved citing the OLD text", async () => {
    const { ticketId } = await simulateEmail(
      adminACtx,
      "Widget won't reset",
      "My widget is stuck. How do I reset it?",
    );

    const ticket = await waitForAutoResolved(ticketId);
    expect(ticket.category).toBe(TICKET_CATEGORY.General);

    const reply = await latestOutboundMessage(ticketId);
    expect(reply.citedArticleIds).toEqual([articleId]);
    expect(reply.textBody).toContain(`ORIGINAL-${runId}`);
    expect(reply.textBody).not.toContain(`UPDATED-${runId}`);
  });

  test("Admin A's edit lands as a pending revision — the live article is unchanged", async () => {
    const res = await adminACtx.patch(
      `${AI_API_URL}/api/knowledge-articles/${articleId}`,
      {
        data: {
          title: articleTitle,
          category: TICKET_CATEGORY.General,
          body: updatedBody,
          internalNote: "",
          autoReply: true,
        },
      },
    );
    expect(res.status()).toBe(202);

    const body = await res.json();
    expect(body.article.body).toBe(originalBody);
    expect(body.pendingRevision.status).toBe(KNOWLEDGE_REVISION_STATUS.pending);
    pendingRevisionId = body.pendingRevision.id;

    const live = await testDb.knowledgeArticle.findUniqueOrThrow({
      where: { id: articleId },
    });
    expect(live.body).toBe(originalBody);
  });

  test("a second matching email still cites the OLD text — the pending edit never reached a customer", async () => {
    const { ticketId } = await simulateEmail(
      adminACtx,
      "Widget still stuck",
      "Same widget issue as before, how do I fix it?",
    );

    const ticket = await waitForAutoResolved(ticketId);
    expect(ticket.category).toBe(TICKET_CATEGORY.General);

    const reply = await latestOutboundMessage(ticketId);
    expect(reply.citedArticleIds).toEqual([articleId]);
    expect(reply.textBody).toContain(`ORIGINAL-${runId}`);
    expect(reply.textBody).not.toContain(`UPDATED-${runId}`);
  });

  test("Admin A cannot approve their own revision", async () => {
    const res = await adminACtx.post(
      `${AI_API_URL}/api/knowledge-articles/${articleId}/revisions/${pendingRevisionId}/approve`,
    );
    expect(res.status()).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "You cannot approve your own revision.",
    });
  });

  test("Admin B is created and promoted, and approves the revision", async () => {
    const createRes = await adminACtx.post(`${AI_API_URL}/api/users`, {
      data: { name: adminBName, email: adminBEmail },
    });
    expect(createRes.status()).toBe(201);

    // There is no API route that sets a role (`POST /api/users` always lands
    // an `agent` — see `createUserSchema`), so promotion goes straight at the
    // test database, the same way this suite always reaches for state no
    // route exposes.
    const link = await waitForInvitationLink(adminBEmail);
    // The link is Better Auth's own redirect endpoint
    // (`GET /api/auth/reset-password/:token`), which only relays the token to
    // the frontend — the token in its path is already the one
    // `POST /api/auth/reset-password` accepts, so there is nothing to follow
    // through a browser for.
    const token = new URL(link).pathname.split("/").at(-1);
    if (!token) throw new Error(`Could not read a token out of ${link}`);

    const resetRes = await adminACtx.post(
      `${AI_API_URL}/api/auth/reset-password`,
      { data: { token, newPassword: adminBPassword } },
    );
    expect(resetRes.status()).toBe(200);

    await testDb.user.update({
      where: { email: adminBEmail },
      data: { role: Role.admin },
    });

    adminBCtx = await pwRequest.newContext();
    await signIn(adminBCtx, adminBEmail, adminBPassword);

    const approveRes = await adminBCtx.post(
      `${AI_API_URL}/api/knowledge-articles/${articleId}/revisions/${pendingRevisionId}/approve`,
    );
    expect(approveRes.status()).toBe(200);

    const approved = await approveRes.json();
    expect(approved.article.body).toBe(updatedBody);
    expect(approved.revision.status).toBe(KNOWLEDGE_REVISION_STATUS.approved);
  });

  test("a third matching email now cites the NEW text — no restart needed", async () => {
    const { ticketId } = await simulateEmail(
      adminACtx,
      "Widget reset one more time",
      "Same widget question, please help.",
    );

    const ticket = await waitForAutoResolved(ticketId);
    expect(ticket.category).toBe(TICKET_CATEGORY.General);

    const reply = await latestOutboundMessage(ticketId);
    expect(reply.citedArticleIds).toEqual([articleId]);
    expect(reply.textBody).toContain(`UPDATED-${runId}`);
    expect(reply.textBody).not.toContain(`ORIGINAL-${runId}`);
  });
});
