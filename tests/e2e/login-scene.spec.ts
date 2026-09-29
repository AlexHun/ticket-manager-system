import { test, expect, type Locator, type Page } from "@playwright/test";
import { BRAND_NAME } from "../../apps/web/src/lib/brand";
import { ROUTE } from "../../apps/web/src/lib/routes";

/**
 * Slice 3 of `docs/plans/forge-desk-rebrand.md` (#341): `/login` is the large
 * THE GREAT / FORGE / DESK lockup beside the sign-in form, still and cooled.
 * This is also exactly what a visitor who asks for reduced motion sees, now
 * and after the strike lands (#342).
 */

function lockup(page: Page) {
  return page.getByRole("heading", { level: 1, name: BRAND_NAME });
}

function signInPanel(page: Page) {
  return page.getByRole("region", { name: "Sign in" });
}

async function boxOf(locator: Locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${locator} is not laid out`);
  return box;
}

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

test.describe("login scene", () => {
  test("at 1280px the lockup and the form sit side by side", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto(ROUTE.login.path);

    const word = await boxOf(lockup(page));
    const form = await boxOf(signInPanel(page));

    // Lockup wholly left of the form, and the two share a band of height.
    expect(word.x + word.width).toBeLessThanOrEqual(form.x);
    expect(word.y).toBeLessThan(form.y + form.height);
    expect(form.y).toBeLessThan(word.y + word.height);
  });

  test("at 390px the lockup is a banner above the form, with no sideways scroll", async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await page.goto(ROUTE.login.path);

    const word = await boxOf(lockup(page));
    const form = await boxOf(signInPanel(page));

    expect(word.y + word.height).toBeLessThanOrEqual(form.y);

    // The lockup fits rather than being cropped. Its own box cannot say so —
    // `max-w-full` clamps it while the letters spill past — and the scene's
    // `overflow-hidden` keeps a spill off the page's scroll width. So ask the
    // scene whether anything inside it overflows.
    const scene = await lockup(page).evaluate((h1) => {
      const scene = h1.parentElement!;
      return { scrollWidth: scene.scrollWidth, clientWidth: scene.clientWidth };
    });
    expect(scene.scrollWidth).toBe(scene.clientWidth);

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBe(overflow.clientWidth);
  });

  test("the email field takes typing straight after navigation", async ({
    page,
  }) => {
    await page.goto(ROUTE.login.path);

    // No wait on the scene: `fill` would retry until the field is editable,
    // so focus and type by keyboard and read back what landed.
    const email = page.getByLabel("Email");
    await email.focus();
    await email.press("ControlOrMeta+a");
    await page.keyboard.type("visitor@example.com");

    await expect(email).toHaveValue("visitor@example.com");
    await expect(email).toBeFocused();
  });

  test("the lockup is the only picture on the page", async ({ page }) => {
    await page.goto(ROUTE.login.path);
    await expect(lockup(page)).toBeVisible();

    // No anvil, forge or hallmark: nothing drawn but the letters. Lucide
    // spinners are the one svg a submit can show, and none is up at rest.
    await expect(page.locator("main svg, main img, main canvas")).toHaveCount(
      0,
    );
  });
});
