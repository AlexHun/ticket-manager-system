import {
  expect,
  request as pwRequest,
  test,
  type APIRequestContext,
} from "@playwright/test";
import {
  PIPELINE_OUTCOME,
  TICKET_CATEGORY,
  TICKET_STATUS,
  type PipelineOverviewResponse,
  type PipelineRun,
} from "@ticket/shared";
import { KNOWLEDGE_ARTICLE_MARKER } from "./fake-openai/constants";
import { CREDENTIALS } from "./helpers/auth";
import { resetTickets, testDb } from "./helpers/db";

/**
 * #360: `/pipeline` reads whether the auto-reply was offered a ticket off the
 * ticket itself (`autoReplyOfferedAt`), never off today's settings.
 *
 * The bug is only visible on a deployment where the auto-reply *could* run, so
 * every assertion is made against the AI-enabled API on :3003 (see
 * `knowledge-auto-reply-approval.spec.ts` for why that server exists), through
 * the real `GET /api/pipeline` and so through its real `getBoss()`, which no
 * unit test reaches. `request`-level only: the web app on :4001 talks to :3002.
 *
 * The corpus has to hold an auto-replyable article for the whole file. Without
 * one the old code read "nothing will run" from the settings, and the first
 * test would pass for the wrong reason instead of failing before the fix.
 */

const AI_API_URL = "http://localhost:3003";
const ADMIN = CREDENTIALS.admin;

/** Pinned an hour back, per the time-sliced-rows rule in `testing-api.md`. */
const AN_HOUR_AGO = () => new Date(Date.now() - 60 * 60 * 1_000);

async function seedClassified(
  subject: string,
  autoReplyOfferedAt: Date | null,
): Promise<number> {
  const createdAt = AN_HOUR_AGO();
  const ticket = await testDb.ticket.create({
    data: {
      subject,
      customerEmail: "e2e-pipeline-offer@example.com",
      customerName: "E2E Offer Customer",
      status: TICKET_STATUS.New,
      category: TICKET_CATEGORY.General,
      classifiedAt: createdAt,
      autoReplyOfferedAt,
      createdAt,
    },
    select: { id: true },
  });
  return ticket.id;
}

async function runOf(
  ctx: APIRequestContext,
  ticketId: number,
): Promise<PipelineRun> {
  const res = await ctx.get(`${AI_API_URL}/api/pipeline`);
  expect(res.status()).toBe(200);
  const body = (await res.json()) as PipelineOverviewResponse;
  const run = body.recent.find((r) => r.ticketId === ticketId);
  if (!run) throw new Error(`Ticket ${ticketId} is not in Recent arrivals`);
  return run;
}

/** Poll the row until the auto-reply has reached a verdict on it. */
async function waitForVerdict(ticketId: number, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const ticket = await testDb.ticket.findUniqueOrThrow({
      where: { id: ticketId },
    });
    if (ticket.autoResolvedAt !== null || ticket.autoReplyDecline !== null) {
      return ticket;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Ticket ${ticketId} reached no auto-reply verdict within ${timeoutMs}ms ` +
          `(status=${ticket.status}, category=${ticket.category}, ` +
          `offeredAt=${ticket.autoReplyOfferedAt?.toISOString() ?? "null"})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

test.describe.serial("Pipeline: the auto-reply offer is recorded", () => {
  let ctx: APIRequestContext;
  let articleId: string | undefined;

  test.beforeAll(async () => {
    ctx = await pwRequest.newContext();
    const signIn = await ctx.post(`${AI_API_URL}/api/auth/sign-in/email`, {
      data: { email: ADMIN.email, password: ADMIN.password },
    });
    expect(signIn.ok()).toBe(true);

    const res = await ctx.post(`${AI_API_URL}/api/knowledge-articles`, {
      data: {
        title: "How do I reset the E2E offer widget?",
        category: TICKET_CATEGORY.General,
        body: `${KNOWLEDGE_ARTICLE_MARKER} Press and hold the button for ten seconds to reset the widget.`,
        internalNote: "",
        autoReply: true,
      },
    });
    expect(res.status()).toBe(201);
    articleId = (await res.json()).article.id;
  });

  test.afterAll(async () => {
    // Archived rather than deleted: nothing in the app deletes an article, and
    // an archived one drops out of the corpus, so later specs see it as before.
    if (articleId) {
      await ctx
        .post(`${AI_API_URL}/api/knowledge-articles/${articleId}/archive`, {
          data: { archived: true },
        })
        .catch(() => {});
    }
    await ctx?.dispose();
    await resetTickets();
  });

  test.beforeEach(async () => {
    await resetTickets();
  });

  test("a classified ticket with no recorded offer reads notOffered", async () => {
    // R1 and R7: classified while the auto-reply was off, or before the column
    // existed. The switch is on today and the corpus is not empty, and still
    // nothing will ever enqueue this ticket.
    const id = await seedClassified("Classified while switched off", null);

    expect((await runOf(ctx, id)).outcome).toBe(PIPELINE_OUTCOME.notOffered);
  });

  test("a classified ticket with a recorded offer, still New, reads pending", async () => {
    const id = await seedClassified("Offered and waiting", AN_HOUR_AGO());

    expect((await runOf(ctx, id)).outcome).toBe(PIPELINE_OUTCOME.pending);
  });

  test("a simulated ticket gets its offer recorded and settles to a verdict", async () => {
    // R4, end to end: ingest, classify, `enqueueAutoReply` stamping the offer
    // in the job's own transaction, and the worker answering it.
    const res = await ctx.post(`${AI_API_URL}/api/pipeline/simulate`, {
      data: {
        localPart: `e2e-offer-${Date.now()}`,
        senderName: "E2E Offer Customer",
        subject: "Widget won't reset",
        textBody: "My widget is stuck. How do I reset it?",
        htmlBody: "",
        inReplyTo: "",
      },
    });
    expect(res.status()).toBe(201);
    const { ticketId } = (await res.json()) as { ticketId: number };

    const ticket = await waitForVerdict(ticketId);
    expect(ticket.autoReplyOfferedAt).not.toBeNull();

    expect([PIPELINE_OUTCOME.resolved, PIPELINE_OUTCOME.declined]).toContain(
      (await runOf(ctx, ticketId)).outcome,
    );
  });
});
