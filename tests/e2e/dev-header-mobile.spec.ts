import { test, expect, type Locator, type Page } from "@playwright/test";
import { ROUTE } from "../../apps/web/src/lib/routes";

/**
 * #617: at 390px the dev tools header ran past the right edge. "Dev tools"
 * and "Project map" wrapped onto two lines, and the Sessions tab was cut off
 * with no way to scroll to it, so on that page the current tab could not be
 * seen at all.
 *
 * The labels are retyped rather than read off `DEV_NAV_ITEMS`, which is empty
 * outside `vite dev` and imports icons Playwright's loader cannot resolve.
 */
const TABS = [
  { label: "Project map", path: ROUTE.devMap.path },
  { label: "Tests", path: ROUTE.devTests.path },
  { label: "Usage", path: ROUTE.devUsage.path },
  { label: "Sessions", path: ROUTE.devSessions.path },
] as const;

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

function nav(page: Page) {
  return page.getByRole("navigation", { name: "Dev tools" });
}

function tab(page: Page, label: string) {
  return nav(page).getByRole("link", { name: label, exact: true });
}

/**
 * A pixel of slack. Scrolled to its end, the row left Sessions 0.23px past its
 * edge: `scrollWidth` is a whole number while the tabs' widths are not.
 */
const SUBPIXEL = 1;

/**
 * Whether a tab's whole box is inside the row's visible part, and so inside
 * the window: a tab the row has clipped is not on screen however near it is.
 */
async function onScreen(page: Page, label: string) {
  const [box, row] = await Promise.all([
    tab(page, label).boundingBox(),
    nav(page).boundingBox(),
  ]);
  if (!box || !row) throw new Error(`${label}: not laid out`);
  return (
    row.x >= 0 &&
    row.x + row.width <= PHONE.width &&
    box.x >= row.x - SUBPIXEL &&
    box.x + box.width <= row.x + row.width + SUBPIXEL
  );
}

/**
 * How many lines the element's text is laid out on. Text nodes only: a tab's
 * icon is a box of its own, a few pixels off the text's line top.
 */
function linesOf(locator: Locator) {
  return locator.evaluate((element) => {
    const tops = new Set<number>();
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) tops.add(Math.round(rect.top));
    }
    return tops.size;
  });
}

test.describe("dev tools header at phone width", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(PHONE);
  });

  for (const { label, path } of TABS) {
    test(`on ${label}, the current tab is on screen when the page opens`, async ({
      page,
    }) => {
      await page.goto(path);
      const current = tab(page, label);
      await expect(current).toHaveAttribute("aria-current", "page");

      await expect.poll(() => onScreen(page, label)).toBe(true);
    });
  }

  test("the current tab stays on screen when the window narrows", async ({
    page,
  }) => {
    // Opened wide, where nothing scrolls, then narrowed: the row shrinks but
    // the tab keeps its size, so watching the tab alone never moved it.
    await page.setViewportSize(DESKTOP);
    await page.goto(ROUTE.devSessions.path);
    await expect(tab(page, "Sessions")).toBeVisible();

    await page.setViewportSize(PHONE);
    await expect.poll(() => onScreen(page, "Sessions")).toBe(true);
  });

  test("the lockup and every tab label sit on one line", async ({ page }) => {
    await page.goto(ROUTE.devMap.path);
    const lockup = page
      .getByRole("banner")
      .getByText("Dev tools", { exact: true });

    expect(await linesOf(lockup)).toBe(1);
    for (const { label } of TABS) {
      expect(await linesOf(tab(page, label)), label).toBe(1);
    }
  });

  test("every tab can be reached by keyboard and by pointer", async ({
    page,
  }) => {
    await page.goto(ROUTE.devMap.path);
    await expect(tab(page, "Project map")).toBeVisible();

    // Keyboard: Tab from the lockup walks the four tabs in order, each one
    // brought on screen as it takes focus.
    await page.getByRole("link", { name: "Dev tools" }).first().focus();
    for (const { label } of TABS) {
      await page.keyboard.press("Tab");
      await expect(tab(page, label)).toBeFocused();
      await expect
        .poll(() => onScreen(page, label), { message: label })
        .toBe(true);
    }

    // Pointer: a click on the furthest tab lands, which Playwright refuses
    // for a link clipped outside the window.
    await tab(page, "Sessions").click();
    await expect(page).toHaveURL(ROUTE.devSessions.path);
    await expect(tab(page, "Sessions")).toHaveAttribute("aria-current", "page");
  });

  test("the header does not widen the page", async ({ page }) => {
    for (const viewport of [PHONE, DESKTOP]) {
      await page.setViewportSize(viewport);
      await page.goto(ROUTE.devSessions.path);
      const header = page.getByRole("banner");
      await expect(header).toBeVisible();
      const box = await header.boundingBox();
      expect(box!.x + box!.width, `${viewport.width}px`).toBeLessThanOrEqual(
        viewport.width,
      );
      expect(
        await header.evaluate((el) => el.scrollWidth <= el.clientWidth),
        `${viewport.width}px`,
      ).toBe(true);
    }
  });
});
