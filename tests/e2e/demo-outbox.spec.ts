import { test, expect } from "@playwright/test";
import {
  MESSAGE_DIRECTION,
  OUTBOUND_EMAIL_STATUS,
  TICKET_STATUS,
} from "@ticket/shared";
import { ROUTE, ticketDetailPath } from "../../apps/web/src/lib/routes";
import { signIn } from "./helpers/auth";
import { resetDemoUsers, resetE2eEmails, testDb } from "./helpers/db";
import { startDemo } from "./helpers/demo";

/**
 * A demo visitor's email is never delivered (#325, PRD R10).
 *
 * A demo replies through the real composer, and an admin then finds the reply
 * on `/outbox` reading as not sent — recorded, so the admin can see what a
 * visitor wrote, and settled from birth, so nothing will send it. No E2E server
 * binds a mail provider, so the half that holds with one bound is the API's
 * (`jobs/send-email.test.ts`, `routes/outbox.test.ts`).
 */

/** Swept by `resetE2eEmails`, like every address the suite mails. */
const CUSTOMER_EMAIL = "e2e-demo-outbox@example.com";
const SUBJECT = "Demo outbox: where is my order";
const REPLY = "A demo visitor says hello — this never leaves the desk.";

let ticketId: number;

test.beforeEach(async () => {
  await resetDemoUsers();
  const ticket = await testDb.ticket.create({
    data: {
      subject: SUBJECT,
      customerEmail: CUSTOMER_EMAIL,
      customerName: "Owen Outbox",
      status: TICKET_STATUS.Open,
      messages: {
        create: {
          messageId: `e2e-demo-outbox-${Date.now()}@example.com`,
          direction: MESSAGE_DIRECTION.inbound,
          senderEmail: CUSTOMER_EMAIL,
          senderName: "Owen Outbox",
          textBody: "My order never arrived.",
        },
      },
    },
    select: { id: true },
  });
  ticketId = ticket.id;
});

test.afterEach(async () => {
  await testDb.ticket.deleteMany({ where: { id: ticketId } });
  await resetE2eEmails();
  await resetDemoUsers();
});

test("a demo's reply reaches the outbox as not sent, and is never queued", async ({
  page,
  browser,
}) => {
  await startDemo(page);
  await page.goto(ticketDetailPath(ticketId));
  const sent = page.waitForResponse(
    (res) =>
      res.url().endsWith(`/api/tickets/${ticketId}/messages`) &&
      res.request().method() === "POST",
  );
  await page.getByRole("textbox", { name: "Reply" }).fill(REPLY);
  await page.getByRole("button", { name: "Send reply" }).click();
  expect((await sent).status()).toBe(201);

  // Born settled: it never passed through `queued`, so no worker was asked.
  const row = await testDb.outboundEmail.findFirstOrThrow({
    where: { toEmail: CUSTOMER_EMAIL },
    select: { status: true, attempts: true },
  });
  expect(row).toEqual({ status: OUTBOUND_EMAIL_STATUS.withheld, attempts: 0 });

  // An admin, in a browser of their own, sees it on the outbox.
  const context = await browser.newContext();
  const admin = await context.newPage();
  await signIn(admin, "admin");
  await admin.goto(ROUTE.outbox.path);

  const card = admin.locator('[data-slot="card"]', {
    hasText: `Re: ${SUBJECT}`,
  });
  await expect(card).toContainText("Not sent (demo)");
  await expect(card).toContainText("a demo session's email is never sent");
  await expect(card.getByRole("button", { name: "Try again" })).toHaveCount(0);

  await card.getByRole("button", { name: "Show message" }).click();
  await expect(card).toContainText(REPLY);
  await context.close();
});
