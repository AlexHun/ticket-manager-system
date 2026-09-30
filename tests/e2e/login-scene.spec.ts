import { test, expect, type Locator, type Page } from "@playwright/test";
import { BRAND_NAME } from "../../apps/web/src/lib/brand";
import { ROUTE } from "../../apps/web/src/lib/routes";
import { CREDENTIALS, signIn } from "./helpers/auth";

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
    await expect(page.locator("main svg, main img")).toHaveCount(0);
  });

  test("with reduced motion, no embers mount and the lockup is cooled at first paint", async ({
    page,
  }) => {
    await recordStrikes(page);
    await page.goto(ROUTE.login.path);
    await expect(lockup(page)).toBeVisible();

    expect(await strikesSeen(page)).toEqual(["cooled"]);
    await expect(page.locator("main canvas")).toHaveCount(0);
  });
});

/**
 * Slice 4 (#343): the strike and the embers, which only exist while motion is
 * allowed. The suite emulates reduced motion everywhere else, for the reason
 * `playwright.config.ts` gives, so this block asks for the opposite.
 */
test.describe("login scene with motion", () => {
  test.use({ contextOptions: { reducedMotion: "no-preference" } });

  test("a load strikes and cools within 5 s, and a reload strikes again", async ({
    page,
  }) => {
    await recordStrikes(page);

    for (const load of [
      () => page.goto(ROUTE.login.path),
      () => page.reload(),
    ]) {
      await load();
      await expect(scene(page)).toHaveAttribute("data-strike", "cooled", {
        timeout: 5_000,
      });
      expect(await strikesSeen(page)).toEqual(["waiting", "playing", "cooled"]);
    }
  });

  test("signing in plays no strike", async ({ page }) => {
    await recordStrikes(page);
    await page.goto(ROUTE.login.path);
    await expect(scene(page)).toHaveAttribute("data-strike", "cooled", {
      timeout: 5_000,
    });
    await forgetStrikes(page);

    const { email, password } = CREDENTIALS.admin;
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/");
    await expect(
      page.getByRole("link", { name: "Tickets", exact: true }),
    ).toBeVisible();

    expect(await strikesSeen(page)).toEqual([]);
  });

  test("the email field takes typing while the strike is playing", async ({
    page,
  }) => {
    await page.goto(ROUTE.login.path);
    await expect(scene(page)).toHaveAttribute("data-strike", "playing");

    // A click, not `focus()`: an overlay from the strike that caught the
    // pointer is how this would break. Select-all clears the dev prefill.
    const email = page.getByLabel("Email");
    await email.click();
    await email.press("ControlOrMeta+a");
    await page.keyboard.type("visitor@example.com");

    await expect(email).toHaveValue("visitor@example.com");
    // Still mid-strike, so the typing above happened during it.
    await expect(scene(page)).toHaveAttribute("data-strike", "playing");
  });

  test("never more than 60 embers, and none change once the tab is hidden", async ({
    page,
  }) => {
    await page.goto(ROUTE.login.path);
    const embers = page.locator("main canvas[data-ember-count]");
    await expect(embers).toHaveCount(1);
    await expect(embers).toHaveAttribute("aria-hidden", "true");

    const visible = await sampleEmbers(page, 3_000);
    expect(Math.max(...visible)).toBeLessThanOrEqual(60);
    expect(Math.min(...visible)).toBeGreaterThan(0);
    // Live, not a constant written once — else the hidden check means nothing.
    expect(new Set(visible).size).toBeGreaterThan(1);

    // Playwright cannot background a tab, so report hidden the way a browser
    // does: `document.hidden` and one `visibilitychange`.
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { get: () => true });
      Object.defineProperty(document, "visibilityState", {
        get: () => "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const hidden = await sampleEmbers(page, 1_000);
    expect(new Set(hidden).size).toBe(1);
  });

  test("a signed-in load of the tickets page fetches none of the login scene", async ({
    page,
  }) => {
    // Stylesheets too: built, `login-scene.css` is a request of its own.
    const fetched: string[] = [];
    page.on("request", (request) => {
      if (["script", "stylesheet"].includes(request.resourceType()))
        fetched.push(request.url());
    });

    // The matcher has to be able to fail: signing in loads the scene.
    await signIn(page, "admin");
    expect(fetched.filter(isLoginScene)).not.toEqual([]);

    fetched.length = 0;
    await page.goto(ROUTE.tickets.path);
    await expect(
      page.getByRole("heading", { name: "Tickets", level: 1 }),
    ).toBeVisible();

    expect(fetched.filter(isLoginScene)).toEqual([]);
  });
});

/** The scene's own module: `LoginScene.tsx` in dev, `LoginScene-<hash>.js` built. */
function isLoginScene(url: string) {
  return /\/LoginScene[.-]/.test(new URL(url).pathname);
}

function scene(page: Page) {
  return page.locator("[data-strike]");
}

/**
 * Keep every `data-strike` value the document shows, in order, from before
 * the first paint. An attribute read after `goto` could not tell a lockup
 * that was cooled all along from one that struck and cooled before the read.
 */
async function recordStrikes(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = [];
    Object.assign(window, { __strikes: seen });
    const note = (el: Element) => {
      const value = el.getAttribute("data-strike");
      if (value && seen.at(-1) !== value) seen.push(value);
    };
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes") note(record.target as Element);
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches("[data-strike]")) note(node);
          node.querySelectorAll("[data-strike]").forEach(note);
        }
      }
    }).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-strike"],
    });
  });
}

function strikesSeen(page: Page) {
  return page.evaluate(
    () => (window as unknown as { __strikes: string[] }).__strikes,
  );
}

function forgetStrikes(page: Page) {
  return page.evaluate(() => {
    (window as unknown as { __strikes: string[] }).__strikes.length = 0;
  });
}

/** The canvas's live ember count, read every 100 ms for `ms`. */
async function sampleEmbers(page: Page, ms: number) {
  const canvas = page.locator("main canvas[data-ember-count]");
  const counts: number[] = [];
  for (let t = 0; t < ms; t += 100) {
    counts.push(Number(await canvas.getAttribute("data-ember-count")));
    await page.waitForTimeout(100);
  }
  return counts;
}
