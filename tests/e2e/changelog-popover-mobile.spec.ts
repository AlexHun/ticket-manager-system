import { test, expect, type Locator, type Page } from "@playwright/test";
import { USER_ROLE } from "@ticket/shared";
import { ROUTE } from "../../apps/web/src/lib/routes";
import { signIn } from "./helpers/auth";

/**
 * The "What's new" popover has to keep a gutter from both screen edges on a
 * phone. It is end-aligned under a trigger near the right of the top bar and
 * was 320px wide with no `collisionPadding`, so at 390px it overflowed the left
 * edge and Radix shifted it flush to x=0 (#401). jsdom has no layout, so only a
 * browser can hold this.
 */

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
/** The gutter the popover keeps from each screen edge on a phone. */
const GUTTER = 16;
/**
 * The room the list keeps right of each date for its scrollbar (`pr-2`).
 * Measured from the list's border box rather than its client area: headless
 * Chromium hides scrollbars and an overlay scrollbar takes no layout space, so
 * a client-area check would hold even with the date under the scrollbar.
 */
const SCROLLBAR_CLEARANCE = 8;
/** Sub-pixel slack for comparing box edges. */
const SLACK = 2;

async function boxOf(locator: Locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${locator} is not laid out`);
  return box;
}

const trigger = (page: Page) =>
  page.getByRole("button", { name: "What's new" });
const popover = (page: Page) => page.getByRole("dialog");
const list = (page: Page) => popover(page).getByRole("list");

async function openPopover(page: Page) {
  await signIn(page, USER_ROLE.admin);
  await page.goto(ROUTE.dashboard.path);
  await trigger(page).click();
  await expect(popover(page)).toBeVisible();
}

test.describe("what's new popover on a phone", () => {
  test(`at ${PHONE.width}px it keeps a ${GUTTER}px gutter from both edges`, async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await openPopover(page);

    const box = await boxOf(popover(page));
    expect(box.x, "left gutter").toBeGreaterThanOrEqual(GUTTER - SLACK);
    expect(
      PHONE.width - (box.x + box.width),
      "right gutter",
    ).toBeGreaterThanOrEqual(GUTTER - SLACK);

    // The list still scrolls inside its own box, and the newest entry's date
    // stops short of the strip its scrollbar is drawn in.
    const geometry = await list(page).evaluate((el) => {
      const date = el.querySelector("li span:last-child");
      if (!date) throw new Error("no entry date");
      return {
        scrolls: el.scrollHeight > el.clientHeight,
        listRight: el.getBoundingClientRect().right,
        dateRight: date.getBoundingClientRect().right,
      };
    });
    expect(geometry.scrolls, "list scrolls").toBe(true);
    expect(
      geometry.listRight - geometry.dateRight,
      "room right of the date",
    ).toBeGreaterThanOrEqual(SCROLLBAR_CLEARANCE - SLACK);
  });

  test(`at ${DESKTOP.width}px it opens end-aligned under its trigger`, async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await openPopover(page);

    const triggerBox = await boxOf(trigger(page));
    const box = await boxOf(popover(page));
    expect(box.x + box.width).toBeCloseTo(triggerBox.x + triggerBox.width, 0);
    expect(box.y).toBeGreaterThanOrEqual(triggerBox.y + triggerBox.height);
    // Its full width, not shrunk by the phone rule.
    expect(box.width).toBeCloseTo(320, 0);
  });
});
