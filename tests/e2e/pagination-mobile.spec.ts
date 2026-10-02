import { test, expect, type Locator, type Page } from "@playwright/test";
import {
  TICKET_ACTIVITY_ACTION,
  TICKET_ACTOR_KIND,
  type UserRole,
} from "@ticket/shared";
import { ROUTE } from "../../apps/web/src/lib/routes";
import { signIn } from "./helpers/auth";
import { testDb } from "./helpers/db";

/**
 * The pagination bar under the tickets list and the activity feed has to fit
 * a phone. Its inner group (page size, page count, both buttons) was one
 * unwrapping flex row, so at 390px "Per page" and the page count were squeezed
 * onto several lines each (#398). jsdom has no layout, so only a browser can
 * hold this.
 */

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
/** WCAG 2.5.8's minimum target size, in CSS pixels. */
const MIN_TARGET = 24;
/**
 * More than one default page on both lists, so the count reads "Page 1 of N"
 * with N above one and Next is live.
 */
const TICKETS = 30;
const SUBJECT = "E2E pagination on a phone";

const PAGES: ReadonlyArray<{ path: string; role: UserRole }> = [
  { path: ROUTE.tickets.path, role: "agent" },
  { path: ROUTE.activity.path, role: "admin" },
];

async function boxOf(locator: Locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${locator} is not laid out`);
  return box;
}

/**
 * Lines the element's text occupies. A flex item reports one box however many
 * lines it wraps to; a Range over its text reports one rect per line.
 */
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

const bar = (page: Page) =>
  page.getByRole("navigation", { name: "Pagination" });
const perPage = (page: Page) =>
  bar(page).getByText("Per page", { exact: true });
const pageCount = (page: Page) => bar(page).getByText(/^Page \d+ of \d+$/);
const previous = (page: Page) =>
  page.getByRole("button", { name: "Previous page" });
const next = (page: Page) => page.getByRole("button", { name: "Next page" });

async function open(page: Page, path: string, role: UserRole) {
  await signIn(page, role);
  await page.goto(path);
  await expect(pageCount(page)).toHaveText(/^Page 1 of (?:[2-9]|\d{2,})$/);
}

test.describe("pagination bar on a phone", () => {
  let ticketIds: number[] = [];

  test.beforeAll(async () => {
    // Each ticket carries a `created` row, so the activity feed pages too.
    const tickets = await testDb.$transaction(
      Array.from({ length: TICKETS }, (_, i) =>
        testDb.ticket.create({
          data: {
            subject: `${SUBJECT} ${i + 1}`,
            customerEmail: `e2e-pagination-${i + 1}@example.com`,
            customerName: "Pat Phone",
            activity: {
              create: {
                action: TICKET_ACTIVITY_ACTION.created,
                actorKind: TICKET_ACTOR_KIND.customer,
                actorName: "Pat Phone",
              },
            },
          },
          select: { id: true },
        }),
      ),
    );
    ticketIds = tickets.map((ticket) => ticket.id);
  });

  test.afterAll(async () => {
    await testDb.ticket.deleteMany({ where: { id: { in: ticketIds } } });
  });

  for (const { path, role } of PAGES) {
    test(`at 390px on ${path} each label holds one line`, async ({ page }) => {
      await page.setViewportSize(PHONE);
      await open(page, path, role);

      expect(await linesOf(perPage(page)), "Per page").toBe(1);
      expect(await linesOf(pageCount(page)), "page count").toBe(1);

      const prev = await boxOf(previous(page));
      const nxt = await boxOf(next(page));
      // Side by side: one row, Previous first.
      expect(nxt.y + nxt.height / 2).toBeCloseTo(prev.y + prev.height / 2, 0);
      expect(nxt.x).toBeGreaterThanOrEqual(prev.x + prev.width);
      for (const [name, box] of [
        ["Previous page", prev],
        ["Next page", nxt],
      ] as const) {
        expect(box.height, name).toBeGreaterThanOrEqual(MIN_TARGET);
        expect(box.x, name).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, name).toBeLessThanOrEqual(PHONE.width);
      }
    });

    test(`at 1280px on ${path} the bar keeps one row`, async ({ page }) => {
      await page.setViewportSize(DESKTOP);
      await open(page, path, role);

      const centres: number[] = [];
      for (const target of [
        bar(page).getByText(/^\d+–\d+ of \d+$/),
        perPage(page),
        pageCount(page),
        previous(page),
        next(page),
      ]) {
        const box = await boxOf(target);
        centres.push(box.y + box.height / 2);
      }
      for (const centre of centres) expect(centre).toBeCloseTo(centres[0]!, 0);
    });
  }
});
