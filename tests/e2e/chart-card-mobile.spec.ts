import { test, expect, type Locator, type Page } from "@playwright/test";
import { MESSAGE_DIRECTION, TICKET_STATUS } from "@ticket/shared";
import { signIn } from "./helpers/auth";
import { testDb } from "./helpers/db";

/**
 * A chart card's headline figure has to leave the title and description the
 * card's width on a phone. It sat in shadcn's `CardAction`, a second grid
 * column spanning both header rows at every width, so at 390px "Time to first
 * reply" wrapped to two lines and its description to five beside
 * "median 6.0h · p90 24h" (#400). jsdom has no layout, so only a browser can
 * hold this.
 */

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
const TITLE = "Time to first reply";
const DESCRIPTION =
  "First outbound message, measured from when the ticket arrived";
/** Sub-pixel slack for comparing box edges. */
const SLACK = 2;
const CUSTOMER = "e2e-chart-card-mobile@example.com";
const HOUR = 60 * 60 * 1000;

async function boxOf(locator: Locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${locator} is not laid out`);
  return box;
}

/** Lines the element's text occupies, one client rect per line. */
async function linesOf(locator: Locator) {
  await expect(locator).toBeVisible();
  return locator.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return new Set(
      [...range.getClientRects()].map((rect) => Math.round(rect.top)),
    ).size;
  });
}

/** The first-response panel, found by its title. Cards carry no role. */
const card = (page: Page) =>
  page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByText(TITLE, { exact: true }) });
const title = (page: Page) => card(page).getByText(TITLE, { exact: true });
const description = (page: Page) =>
  card(page).getByText(DESCRIPTION, { exact: true });
const headline = (page: Page) => card(page).getByText(/^median /);
const toggle = (page: Page) =>
  card(page).getByRole("button", { name: "Show data table" });
const header = (page: Page) => card(page).locator('[data-slot="card-header"]');

/** The element's width inside its horizontal padding. */
async function contentWidthOf(locator: Locator) {
  await expect(locator).toBeVisible();
  return locator.evaluate((el) => {
    const style = getComputedStyle(el);
    return (
      el.clientWidth -
      parseFloat(style.paddingLeft) -
      parseFloat(style.paddingRight)
    );
  });
}

test.describe("chart card headline on a phone", () => {
  let ticketId: number;

  // One answered ticket, so the panel draws its chart and its median rather
  // than the empty state, whatever else the test database holds.
  test.beforeAll(async () => {
    const arrived = new Date(Date.now() - 7 * HOUR);
    const ticket = await testDb.ticket.create({
      data: {
        subject: "E2E chart card on a phone",
        customerEmail: CUSTOMER,
        customerName: "Pat Phone",
        status: TICKET_STATUS.Open,
        createdAt: arrived,
        messages: {
          create: [
            {
              messageId: "e2e-chart-card-mobile-0@example.com",
              direction: MESSAGE_DIRECTION.inbound,
              senderEmail: CUSTOMER,
              senderName: "Pat Phone",
              textBody: "Where is my order?",
              createdAt: arrived,
            },
            {
              messageId: "e2e-chart-card-mobile-1@example.com",
              direction: MESSAGE_DIRECTION.outbound,
              senderEmail: "support@example.com",
              senderName: "Support",
              textBody: "It ships today.",
              createdAt: new Date(arrived.getTime() + 6 * HOUR),
            },
          ],
        },
      },
      select: { id: true },
    });
    ticketId = ticket.id;
  });

  test.afterAll(async () => {
    await testDb.ticket.deleteMany({ where: { id: ticketId } });
  });

  test(`at ${PHONE.width}px the headline takes its own line`, async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await signIn(page, "admin");

    const titleBox = await boxOf(title(page));
    const descriptionBox = await boxOf(description(page));
    const headlineBox = await boxOf(headline(page));
    const headerContentWidth = await contentWidthOf(header(page));

    expect(await linesOf(title(page)), "title").toBe(1);
    // Below the title and the description, not beside them.
    expect(headlineBox.y).toBeGreaterThanOrEqual(
      descriptionBox.y + descriptionBox.height - SLACK,
    );
    expect(descriptionBox.y).toBeGreaterThanOrEqual(
      titleBox.y + titleBox.height - SLACK,
    );
    // The description spans the header's whole content box, not a column of it.
    expect(descriptionBox.width).toBeGreaterThanOrEqual(
      headerContentWidth - SLACK,
    );

    const toggleBox = await boxOf(toggle(page));
    expect(toggleBox.x).toBeGreaterThanOrEqual(0);
    expect(toggleBox.x + toggleBox.width).toBeLessThanOrEqual(PHONE.width);
    await toggle(page).click();
    await expect(
      card(page).getByRole("button", { name: "Show chart" }),
    ).toBeVisible();
  });

  test(`at ${DESKTOP.width}px the headline stays top-right`, async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await signIn(page, "admin");

    const titleBox = await boxOf(title(page));
    const descriptionBox = await boxOf(description(page));
    const headlineBox = await boxOf(headline(page));
    const toggleBox = await boxOf(toggle(page));

    // Beside the heading, above the description, with the toggle to its right.
    expect(headlineBox.x).toBeGreaterThanOrEqual(
      Math.max(
        titleBox.x + titleBox.width,
        descriptionBox.x + descriptionBox.width,
      ) - SLACK,
    );
    expect(headlineBox.y).toBeLessThan(descriptionBox.y);
    expect(toggleBox.x).toBeGreaterThanOrEqual(
      headlineBox.x + headlineBox.width,
    );
  });
});
