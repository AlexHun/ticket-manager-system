import {
  expect,
  request as pwRequest,
  test,
  type APIRequestContext,
} from "@playwright/test";
import {
  MESSAGE_DIRECTION,
  PIPELINE_OUTCOME,
  PIPELINE_STAGE,
  PIPELINE_STAGE_STATE,
  TICKET_ACTIVITY_ACTION,
  TICKET_ACTOR_KIND,
  TICKET_CATEGORY,
  TICKET_STATUS,
  USER_ROLE,
  type AssistantEffectivenessResponse,
  type PipelineOverviewResponse,
  type PipelineRun,
} from "@ticket/shared";
import { ROUTE } from "../../apps/web/src/lib/routes";
import { CREDENTIALS, signIn } from "./helpers/auth";
import { resetTickets, testDb } from "./helpers/db";
import { WEBHOOK_PASSWORD, WEBHOOK_URL, WEBHOOK_USERNAME } from "./helpers/env";

/**
 * One answer to what the assistant decided (`docs/plans/assistant-decisions.md`).
 *
 * Slice 1 (#561): the classifier records the category it filed on the ticket,
 * so an agent clearing that category is a correction, not the classifier giving
 * up. Before it, `/pipeline` drew that ticket `abandoned` at the classified stop
 * (an outage, ADR-0019) and the dashboard dropped it from `classified`.
 *
 * Slice 2 (#562): "resolved by the assistant" is the auto-resolve stamp on both
 * screens. Before it, the dashboard counted the assistant's assignments, so an
 * agent reassigning a ticket the assistant resolved took it out of the
 * published auto-resolve rate while `/pipeline` still drew it resolved.
 *
 * The tickets are seeded as the jobs leave them, and every later change is made
 * through the real route — the agent's correction through
 * `PATCH /api/tickets/:id/category` and `/assignee` and `/status`, the
 * customer's reopen through the inbound-email webhook — never by writing the
 * column. Everything is read off the web app's own API on :3002, the one that
 * serves the rendered `/pipeline`.
 */

const API_URL = "http://localhost:3002";

/** Pinned an hour back, per the time-sliced-rows rule in `testing-api.md`. */
const AN_HOUR_AGO = () => new Date(Date.now() - 60 * 60 * 1_000);

const CUSTOMER = {
  customerEmail: "e2e-assistant-decisions@example.com",
  customerName: "E2E Decisions Customer",
};

/** A ticket as the classifier leaves it after filing: the row and its trail. */
async function seedFiledByClassifier(subject: string): Promise<number> {
  const at = AN_HOUR_AGO();
  const assistant = await testDb.user.findFirstOrThrow({
    where: { automated: true },
    select: { id: true, name: true, email: true },
  });
  const ticket = await testDb.ticket.create({
    data: {
      subject,
      ...CUSTOMER,
      status: TICKET_STATUS.New,
      category: TICKET_CATEGORY.Technical,
      classifierCategory: TICKET_CATEGORY.Technical,
      classifiedAt: at,
      createdAt: at,
    },
    select: { id: true },
  });
  await testDb.ticketActivity.create({
    data: {
      ticketId: ticket.id,
      action: TICKET_ACTIVITY_ACTION.category_changed,
      toValue: TICKET_CATEGORY.Technical,
      actorKind: TICKET_ACTOR_KIND.assistant,
      actorId: assistant.id,
      actorName: assistant.name,
      actorEmail: assistant.email,
      createdAt: at,
    },
  });
  return ticket.id;
}

/** A ticket the classifier's terminal path stamped: no category filed. */
async function seedGivenUp(subject: string): Promise<number> {
  const at = AN_HOUR_AGO();
  const ticket = await testDb.ticket.create({
    data: {
      subject,
      ...CUSTOMER,
      status: TICKET_STATUS.New,
      classifiedAt: at,
      createdAt: at,
    },
    select: { id: true },
  });
  return ticket.id;
}

/**
 * A ticket the auto-reply resolved, as it leaves one: filed under the
 * assistant, stamped, and answered with an automated reply whose `messageId` a
 * customer's reply can thread onto. Returns the ticket and that `messageId`.
 */
async function seedAutoResolved(
  subject: string,
): Promise<{ ticketId: number; replyMessageId: string }> {
  const at = AN_HOUR_AGO();
  const assistant = await testDb.user.findFirstOrThrow({
    where: { automated: true },
    select: { id: true },
  });
  const replyMessageId = `e2e-auto-reply-${subject.replace(/\W+/g, "-")}@example.com`;
  const ticket = await testDb.ticket.create({
    data: {
      subject,
      ...CUSTOMER,
      status: TICKET_STATUS.Resolved,
      category: TICKET_CATEGORY.Technical,
      classifierCategory: TICKET_CATEGORY.Technical,
      classifiedAt: at,
      autoReplyOfferedAt: at,
      autoResolvedAt: at,
      assignedToId: assistant.id,
      createdAt: at,
      messages: {
        create: {
          messageId: replyMessageId,
          senderEmail: "support@example.com",
          senderName: "Support",
          textBody: "Hold the power button for ten seconds.",
          direction: MESSAGE_DIRECTION.outbound,
          automated: true,
          createdAt: at,
        },
      },
    },
    select: { id: true },
  });
  return { ticketId: ticket.id, replyMessageId };
}

async function signedIn(
  credentials: (typeof CREDENTIALS)[keyof typeof CREDENTIALS],
): Promise<APIRequestContext> {
  const ctx = await pwRequest.newContext();
  const res = await ctx.post(`${API_URL}/api/auth/sign-in/email`, {
    data: { email: credentials.email, password: credentials.password },
  });
  expect(res.ok()).toBe(true);
  return ctx;
}

function runFor(body: PipelineOverviewResponse, ticketId: number): PipelineRun {
  const run = body.recent.find((r) => r.ticketId === ticketId);
  if (!run) throw new Error(`Ticket ${ticketId} is not in Recent arrivals`);
  return run;
}

const exitOf = (run: PipelineRun) =>
  run.stages.find((s) => s.state === PIPELINE_STAGE_STATE.exited)?.stage;

test.describe("Assistant decisions: the classifier's verdict is recorded", () => {
  test.beforeEach(async () => {
    await resetTickets();
  });

  test.afterAll(async () => {
    await resetTickets();
  });

  test("an agent clearing the classifier's category is a correction, not an outage", async ({
    page,
  }) => {
    const corrected = await seedFiledByClassifier("Filed, then cleared");
    const givenUp = await seedGivenUp("Given up on");

    // The agent's correction, through the real route.
    const agent = await signedIn(CREDENTIALS.agent);
    const patch = await agent.patch(
      `${API_URL}/api/tickets/${corrected}/category`,
      { data: { category: null } },
    );
    expect(patch.status()).toBe(200);
    await agent.dispose();

    const cleared = await testDb.ticket.findUniqueOrThrow({
      where: { id: corrected },
      select: { category: true, classifierCategory: true },
    });
    expect(cleared).toEqual({
      category: null,
      classifierCategory: TICKET_CATEGORY.Technical,
    });

    const admin = await signedIn(CREDENTIALS.admin);

    // `/pipeline`: the corrected ticket stays past the classified stop; the one
    // the classifier gave up on still exits there (R1, R2).
    const pipelineRes = await admin.get(`${API_URL}/api/pipeline`);
    expect(pipelineRes.status()).toBe(200);
    const pipeline = (await pipelineRes.json()) as PipelineOverviewResponse;

    const correctedRun = runFor(pipeline, corrected);
    expect(correctedRun.outcome).not.toBe(PIPELINE_OUTCOME.abandoned);
    expect(exitOf(correctedRun)).toBeUndefined();

    const givenUpRun = runFor(pipeline, givenUp);
    expect(givenUpRun.outcome).toBe(PIPELINE_OUTCOME.abandoned);
    expect(exitOf(givenUpRun)).toBe(PIPELINE_STAGE.classified);

    expect(pipeline.counts.machineClassified).toBe(1);
    expect(pipeline.counts.classifyAbandoned).toBe(1);

    // The dashboard: classified, and an override (R1).
    const effectivenessRes = await admin.get(
      `${API_URL}/api/tickets/effectiveness`,
    );
    expect(effectivenessRes.status()).toBe(200);
    const effectiveness =
      (await effectivenessRes.json()) as AssistantEffectivenessResponse;
    expect(effectiveness.classified).toBe(1);
    expect(effectiveness.categoryOverride.count).toBe(1);
    await admin.dispose();

    // The rendered Recent arrivals rows.
    await signIn(page, USER_ROLE.admin);
    await page.goto(ROUTE.pipeline.path);
    const recent = page.getByRole("region", { name: "Recent arrivals" });
    const correctedRow = recent
      .getByRole("button")
      .filter({ hasText: "Filed, then cleared" });
    const givenUpRow = recent
      .getByRole("button")
      .filter({ hasText: "Given up on" });

    await expect(givenUpRow).toContainText(PIPELINE_OUTCOME.abandoned);
    await expect(correctedRow).toBeVisible();
    await expect(correctedRow).not.toContainText(PIPELINE_OUTCOME.abandoned);
  });
});

test.describe("Assistant decisions: resolved by the assistant reads one way", () => {
  test.beforeEach(async () => {
    await resetTickets();
  });

  test.afterAll(async () => {
    await resetTickets();
  });

  test("an agent's reassignment withdraws nothing, and a customer's reopen withdraws it everywhere", async ({
    page,
    request,
  }) => {
    const reassigned = await seedAutoResolved("Answered, then reassigned");
    const reopened = await seedAutoResolved("Answered, then reopened");

    // The agent takes the first one over and closes it, through the real routes.
    const agentUser = await testDb.user.findUniqueOrThrow({
      where: { email: CREDENTIALS.agent.email },
      select: { id: true },
    });
    const agent = await signedIn(CREDENTIALS.agent);
    const assign = await agent.patch(
      `${API_URL}/api/tickets/${reassigned.ticketId}/assignee`,
      { data: { assignedToId: agentUser.id } },
    );
    expect(assign.status()).toBe(200);
    const close = await agent.patch(
      `${API_URL}/api/tickets/${reassigned.ticketId}/status`,
      { data: { status: TICKET_STATUS.Closed } },
    );
    expect(close.status()).toBe(200);
    await agent.dispose();

    // The customer writes back on the second one, through the inbound webhook.
    const reply = await request.post(WEBHOOK_URL, {
      data: {
        messageId: "e2e-assistant-decisions-reopen@example.com",
        subject: "Re: Answered, then reopened",
        senderEmail: CUSTOMER.customerEmail,
        senderName: CUSTOMER.customerName,
        textBody: "That didn't help.",
        inReplyTo: reopened.replyMessageId,
      },
      headers: {
        Authorization: `Basic ${Buffer.from(`${WEBHOOK_USERNAME}:${WEBHOOK_PASSWORD}`).toString("base64")}`,
      },
    });
    expect(reply.status()).toBe(201);

    const rows = await testDb.ticket.findMany({
      where: { id: { in: [reassigned.ticketId, reopened.ticketId] } },
      select: { id: true, assignedToId: true, autoResolvedAt: true },
    });
    const rowOf = (id: number) => rows.find((r) => r.id === id);
    expect(rowOf(reassigned.ticketId)?.assignedToId).toBe(agentUser.id);
    expect(rowOf(reassigned.ticketId)?.autoResolvedAt).not.toBeNull();
    expect(rowOf(reopened.ticketId)?.autoResolvedAt).toBeNull();

    const admin = await signedIn(CREDENTIALS.admin);

    // `/pipeline`: the reassigned ticket is still resolved; the reopened one is
    // not (R3).
    const pipelineRes = await admin.get(`${API_URL}/api/pipeline`);
    expect(pipelineRes.status()).toBe(200);
    const pipeline = (await pipelineRes.json()) as PipelineOverviewResponse;
    expect(runFor(pipeline, reassigned.ticketId).outcome).toBe(
      PIPELINE_OUTCOME.resolved,
    );
    expect(runFor(pipeline, reopened.ticketId).outcome).not.toBe(
      PIPELINE_OUTCOME.resolved,
    );
    expect(pipeline.counts.autoResolved).toBe(1);

    // The dashboard counts the same one.
    const effectivenessRes = await admin.get(
      `${API_URL}/api/tickets/effectiveness`,
    );
    expect(effectivenessRes.status()).toBe(200);
    const effectiveness =
      (await effectivenessRes.json()) as AssistantEffectivenessResponse;
    expect(effectiveness.autoReply.resolved).toBe(1);
    await admin.dispose();

    // The rendered Recent arrivals rows.
    await signIn(page, USER_ROLE.admin);
    await page.goto(ROUTE.pipeline.path);
    const recent = page.getByRole("region", { name: "Recent arrivals" });
    const reassignedRow = recent
      .getByRole("button")
      .filter({ hasText: "Answered, then reassigned" });
    const reopenedRow = recent
      .getByRole("button")
      .filter({ hasText: "Answered, then reopened" });

    await expect(reassignedRow).toContainText(PIPELINE_OUTCOME.resolved);
    await expect(reopenedRow).toBeVisible();
    await expect(reopenedRow).not.toContainText(PIPELINE_OUTCOME.resolved);
  });
});
