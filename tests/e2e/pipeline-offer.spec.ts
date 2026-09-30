import {
  expect,
  request as pwRequest,
  test,
  type APIRequestContext,
} from "@playwright/test";
import {
  AUTO_REPLY_DECLINE,
  MESSAGE_DIRECTION,
  PIPELINE_OUTCOME,
  PIPELINE_STAGE,
  PIPELINE_STAGE_STATE,
  TICKET_CATEGORY,
  TICKET_STATUS,
  type PipelineOutcome,
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
 * #361 adds the last test: the rail's counts and the per-ticket outcomes, read
 * off one response, agree over a mix covering every outcome — the one place the
 * real `GET /` is asked both halves at once.
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

  test("the rail's counts and Recent arrivals agree, one response", async () => {
    // R6 (#361). The rail counts the classifier's rule over the whole window
    // and each listed ticket is asked the same rule for its outcome; this reads
    // both off one `GET /api/pipeline`, over a mix covering every outcome and
    // every way an unstamped ticket can go.
    const now = Date.now();
    const at = (msAgo: number) => new Date(now - msAgo);
    const MINUTE = 60 * 1_000;
    const HOUR = 60 * MINUTE;
    const DAY = 24 * HOUR;
    const classified = {
      category: TICKET_CATEGORY.General,
      classifiedAt: at(HOUR),
      createdAt: at(HOUR),
    };

    const seeds = [
      // resolved, by the knowledge base.
      {
        ...classified,
        status: TICKET_STATUS.Resolved,
        autoReplyOfferedAt: at(HOUR),
        autoResolvedAt: at(HOUR),
      },
      // declined: a verdict.
      {
        ...classified,
        status: TICKET_STATUS.Open,
        autoReplyOfferedAt: at(HOUR),
        autoReplyDecline: AUTO_REPLY_DECLINE.notCovered,
        autoReplyDeclinedAt: at(HOUR),
      },
      // abandoned by the auto-reply: an outage is not a verdict.
      {
        ...classified,
        status: TICKET_STATUS.Open,
        autoReplyOfferedAt: at(HOUR),
        autoReplyDecline: AUTO_REPLY_DECLINE.unavailable,
        autoReplyDeclinedAt: at(HOUR),
      },
      // abandoned by the classifier: stamped, no category.
      {
        status: TICKET_STATUS.New,
        classifiedAt: at(HOUR),
        createdAt: at(HOUR),
      },
      // pending on the auto-reply: offered, still New.
      {
        ...classified,
        status: TICKET_STATUS.New,
        autoReplyOfferedAt: at(HOUR),
      },
      // notOffered by the auto-reply: classified, never offered.
      { ...classified, status: TICKET_STATUS.New },
      // pending on the classifier: unfiled, inside the window. Five minutes
      // old, under the reconcile sweep's ten-minute floor, so this server's
      // sweep cannot classify it between the seed and the read.
      { status: TICKET_STATUS.New, createdAt: at(5 * MINUTE) },
      // notOffered by the classifier: unfiled, past the window.
      { status: TICKET_STATUS.New, createdAt: at(DAY + HOUR) },
      // notOffered by the classifier: a category filed by hand.
      {
        status: TICKET_STATUS.New,
        category: TICKET_CATEGORY.Technical,
        createdAt: at(HOUR),
      },
    ];
    const customer = {
      customerEmail: "e2e-pipeline-offer@example.com",
      customerName: "E2E Offer Customer",
    };
    for (const [i, data] of seeds.entries()) {
      await testDb.ticket.create({
        data: { subject: `Pipeline mix ${i}`, ...customer, ...data },
      });
    }

    // Reopened: machine-resolved, then the customer wrote back, which clears
    // `autoResolvedAt` (`ingest.ts`). Answered and offered, so `notOffered`.
    const reopened = await testDb.ticket.create({
      data: {
        subject: "Pipeline mix reopened",
        ...customer,
        ...classified,
        status: TICKET_STATUS.Open,
        autoReplyOfferedAt: at(HOUR),
      },
    });
    await testDb.message.create({
      data: {
        ticketId: reopened.id,
        messageId: `e2e-pipeline-reopened.${now}@tickets.example.com`,
        senderEmail: "support@tickets.example.com",
        senderName: "Support",
        textBody: "Hold the button for ten seconds.",
        direction: MESSAGE_DIRECTION.outbound,
        automated: true,
        createdAt: at(HOUR),
      },
    });

    const res = await ctx.get(`${AI_API_URL}/api/pipeline`);
    expect(res.status()).toBe(200);
    const { counts, recent } = (await res.json()) as PipelineOverviewResponse;

    // Every row is listed, so the counts describe exactly these runs.
    expect(recent).toHaveLength(seeds.length + 1);
    expect(counts.received).toBe(recent.length);
    // And the mix is not vacuous: every outcome is on screen.
    expect(new Set(recent.map((r) => r.outcome))).toEqual(
      new Set(Object.values(PIPELINE_OUTCOME)),
    );

    const classifiedStop = (run: PipelineRun) =>
      run.stages.find((s) => s.stage === PIPELINE_STAGE.classified)!;
    const unstamped = recent.filter((r) => classifiedStop(r).at === null);
    const stamped = recent.filter((r) => classifiedStop(r).at !== null);
    const classifyExit = (r: PipelineRun) =>
      classifiedStop(r).state === PIPELINE_STAGE_STATE.exited;
    const count = (runs: PipelineRun[], outcome: PipelineOutcome) =>
      runs.filter((r) => r.outcome === outcome).length;

    expect({
      machineClassified: counts.machineClassified,
      classifyAbandoned: counts.classifyAbandoned,
      classifyPending: counts.classifyPending,
      classifyNotOffered: counts.classifyNotOffered,
      autoResolved: counts.autoResolved,
      declines: Object.values(counts.declines).reduce((a, b) => a + b, 0),
    }).toEqual({
      machineClassified: stamped.filter((r) => !classifyExit(r)).length,
      classifyAbandoned: stamped.filter(classifyExit).length,
      classifyPending: count(unstamped, PIPELINE_OUTCOME.pending),
      classifyNotOffered: count(unstamped, PIPELINE_OUTCOME.notOffered),
      autoResolved: count(recent, PIPELINE_OUTCOME.resolved),
      declines: recent.filter((r) => r.decline !== null).length,
    });
    // Literals beside the agreement, so both sides drifting together is still
    // caught: one inside the window, two it will never act on.
    expect(counts.classifyPending).toBe(1);
    expect(counts.classifyNotOffered).toBe(2);
  });
});
