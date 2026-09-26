import { test, expect, type Page } from "@playwright/test";
import { TICKET_STATUS } from "@ticket/shared";
import { ROUTE, ticketDetailPath } from "../../apps/web/src/lib/routes";
import { freshClientAddress, fromAddress } from "./helpers/client-address";
import { resetDemoUsers, resetTickets, testDb } from "./helpers/db";
import { runDemoReset } from "./helpers/demo-reset";
import { WEBHOOK_PASSWORD, WEBHOOK_URL, WEBHOOK_USERNAME } from "./helpers/env";

/**
 * The nightly reset (#323, PRD R6): what a visitor does to the showcase is gone
 * by the next morning, and nothing else is.
 *
 * The night is `runDemoReset()` — the sweep's own `run`, called from here
 * rather than waited for (see that helper). Everything around it goes through
 * the real app: a demo closes a seeded ticket on its detail page, a real
 * customer's email arrives through the webhook, and a fresh visitor reads the
 * morning after in a browser of their own.
 *
 * The test database carries no showcase (`prisma/seed.ts` writes none, so the
 * other specs have a clean desk), so the first reset is what puts it there,
 * and `resetTickets()` takes it away again afterwards.
 */

const CUSTOMER_EMAIL = "e2e-reset-customer@example.com";

test.beforeAll(async () => {
  await resetTickets();
  await resetDemoUsers();
  await runDemoReset();
});

test.afterAll(async () => {
  await resetTickets();
  await resetDemoUsers();
});

/** Start a demo from an address of its own, as `demo-session.spec.ts` does. */
async function startDemo(page: Page): Promise<void> {
  await page.context().setExtraHTTPHeaders(fromAddress(freshClientAddress()));
  await page.goto(ROUTE.login.path);
  await page.getByRole("button", { name: "Use demo session" }).click();
  await page.waitForURL(ROUTE.dashboard.path);
}

/** Pick `status` from the detail page's Status control and wait for the save. */
async function setStatus(page: Page, ticketId: number, status: string) {
  await page.getByRole("combobox", { name: "Status" }).click();
  const saved = page.waitForResponse(
    (res) =>
      res.url().endsWith(`/api/tickets/${ticketId}/status`) &&
      res.request().method() === "PATCH",
  );
  await page.getByRole("option", { name: status, exact: true }).click();
  expect((await saved).status()).toBe(200);
}

test("a demo's change to a seeded ticket is gone after the night; a real ticket's is not", async ({
  page,
  browser,
  request,
}) => {
  // A seeded ticket still open, and the key the seed knows it by.
  const seeded = await testDb.ticket.findFirstOrThrow({
    where: { status: TICKET_STATUS.Open },
    orderBy: { id: "asc" },
    select: { id: true, subject: true, customerEmail: true },
  });

  // A real customer writes in through the webhook.
  const ingested = await request.post(WEBHOOK_URL, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${WEBHOOK_USERNAME}:${WEBHOOK_PASSWORD}`).toString("base64")}`,
    },
    data: {
      messageId: `<e2e-reset-${Date.now()}@example.com>`,
      subject: "Invoice address is wrong",
      senderEmail: CUSTOMER_EMAIL,
      senderName: "Rae Real",
      textBody: "Our invoice has last year's address on it.",
    },
  });
  expect(ingested.status()).toBe(201);
  const { ticketId: realId } = (await ingested.json()) as { ticketId: number };

  // The day's visitor closes the seeded ticket and resolves the real one.
  await startDemo(page);
  await page.goto(ticketDetailPath(seeded.id));
  await setStatus(page, seeded.id, TICKET_STATUS.Closed);
  await page.goto(ticketDetailPath(realId));
  await setStatus(page, realId, TICKET_STATUS.Resolved);

  await runDemoReset();

  // The morning after, a new visitor finds the seeded ticket as it was seeded.
  // A reset re-creates the showcase, so it is found again by its seed key.
  const morning = await testDb.ticket.findFirstOrThrow({
    where: { subject: seeded.subject, customerEmail: seeded.customerEmail },
    select: { id: true },
  });
  const context = await browser.newContext();
  const fresh = await context.newPage();
  await startDemo(fresh);
  await fresh.goto(ticketDetailPath(morning.id));
  await expect(fresh.getByRole("combobox", { name: "Status" })).toContainText(
    TICKET_STATUS.Open,
  );

  // The real ticket kept what the day did to it.
  await fresh.goto(ticketDetailPath(realId));
  await expect(fresh.getByRole("combobox", { name: "Status" })).toContainText(
    TICKET_STATUS.Resolved,
  );
  await context.close();

  // And yesterday's visitor, whose session is still live, was not thrown out.
  await page.goto(ROUTE.tickets.path);
  await expect(page).toHaveURL(ROUTE.tickets.path);
  await expect(page.locator("header").getByText("Demo visitor")).toBeVisible();
});
