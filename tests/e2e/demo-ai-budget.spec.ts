import {
  test,
  expect,
  request as pwRequest,
  type APIRequestContext,
} from "@playwright/test";
import {
  DEMO_AI_LIMIT_MESSAGE,
  DEMO_AI_LIMIT_REASON,
  MESSAGE_DIRECTION,
  TICKET_STATUS,
} from "@ticket/shared";
import { POLISHED_REPLY } from "./fake-openai/constants";
import { CREDENTIALS } from "./helpers/auth";
import { freshClientAddress, fromAddress } from "./helpers/client-address";
import { resetDemoAiSpend, resetDemoUsers, testDb } from "./helpers/db";

/**
 * The demo sessions' $1 daily AI budget (#321, PRD R8), end to end through the
 * real route, the real `polishDraft` and the real ledger.
 *
 * Against the AI server on :3003 and the fake OpenAI, the only API in the
 * suite that can reach a model. `.env.test.ai` sets `DEMO_AI_DAILY_USD` below
 * the cost of one fake call, so the first demo polish spends the day and the
 * second is refused without a call. No web server fronts :3003, so how the
 * limit reads on screen is `TicketReplyComposer.test.tsx`'s and
 * `TicketSummaryPanel.test.tsx`'s job; this file is about what the server does.
 */

/** The AI-enabled API — see `playwright.config.ts`. */
const AI_API_URL = "http://localhost:3003";

/** The ticket's customer. Polishing sends nothing, so nothing is ever mailed. */
const CUSTOMER_EMAIL = "e2e-demo-ai-customer@example.com";

let ticketId: number;
let demo: APIRequestContext;
let admin: APIRequestContext;

test.beforeEach(async () => {
  await resetDemoAiSpend();
  await resetDemoUsers();
  const ticket = await testDb.ticket.create({
    data: {
      subject: "Where is my parcel?",
      customerEmail: CUSTOMER_EMAIL,
      customerName: "Dana Demo",
      status: TICKET_STATUS.Open,
      messages: {
        create: {
          messageId: `<e2e-demo-ai-${Date.now()}@example.com>`,
          direction: MESSAGE_DIRECTION.inbound,
          senderEmail: CUSTOMER_EMAIL,
          senderName: "Dana Demo",
          textBody: "My parcel never arrived.",
        },
      },
    },
    select: { id: true },
  });
  ticketId = ticket.id;

  // Two contexts, so each keeps its own session cookie. Each demo start comes
  // from an address of its own, so this file never meets the five-an-hour
  // start limit (#322) on a server that outlives the run.
  demo = await pwRequest.newContext({
    extraHTTPHeaders: fromAddress(freshClientAddress()),
  });
  const started = await demo.post(`${AI_API_URL}/api/auth/sign-in/anonymous`);
  expect(started.ok()).toBe(true);

  admin = await pwRequest.newContext();
  const signedIn = await admin.post(`${AI_API_URL}/api/auth/sign-in/email`, {
    data: {
      email: CREDENTIALS.admin.email,
      password: CREDENTIALS.admin.password,
    },
  });
  expect(signedIn.ok()).toBe(true);
});

test.afterEach(async () => {
  await demo.dispose();
  await admin.dispose();
  await testDb.ticket.deleteMany({ where: { id: ticketId } });
  await resetDemoUsers();
  await resetDemoAiSpend();
});

function polish(ctx: APIRequestContext) {
  return ctx.post(`${AI_API_URL}/api/ai/polish-reply`, {
    data: { draft: "its on the way", ticketId },
  });
}

test("the first demo polish spends the day, the second makes no call, and an admin still polishes", async () => {
  const first = await polish(demo);
  expect(first.status()).toBe(200);
  expect(await first.json()).toEqual({ polished: POLISHED_REPLY });

  const second = await polish(demo);
  expect(second.status()).toBe(429);
  expect(await second.json()).toEqual({
    error: DEMO_AI_LIMIT_MESSAGE,
    reason: DEMO_AI_LIMIT_REASON,
  });

  const byAdmin = await polish(admin);
  expect(byAdmin.status()).toBe(200);
  expect(await byAdmin.json()).toEqual({ polished: POLISHED_REPLY });
});

// Every demo visitor shares the one total: a fresh click on the login button
// is a fresh identity, and must not be a fresh budget.
test("a second demo session finds the day already spent", async () => {
  expect((await polish(demo)).status()).toBe(200);

  const other = await pwRequest.newContext({
    extraHTTPHeaders: fromAddress(freshClientAddress()),
  });
  try {
    await other.post(`${AI_API_URL}/api/auth/sign-in/anonymous`);
    expect((await polish(other)).status()).toBe(429);
  } finally {
    await other.dispose();
  }
});
