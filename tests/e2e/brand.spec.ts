import { test, expect, type Page } from "@playwright/test";
import { signIn } from "./helpers/auth";
// The names under test, from the module the app reads them from — the same
// reach into the web app's source `route-timing.spec.ts` makes. `brand.ts` is
// import-free for exactly this.
import { BRAND_NAME, BRAND_SHORT } from "../../apps/web/src/lib/brand";
import { ROUTE } from "../../apps/web/src/lib/routes";

/**
 * Slice 1 of `docs/plans/forge-desk-rebrand.md` (#339): the product is called
 * The Great Forge Desk everywhere a visitor sees a name, in its own face.
 *
 * The family name is what `@fontsource-variable/big-shoulders-display`
 * declares, and it is restated rather than imported: it is the package's
 * contract, not the app's.
 */
const BRAND_FAMILY = "Big Shoulders Display Variable";

/** Every public page that names the product, before sign-in. */
const PUBLIC_PAGES = [
  ROUTE.login.path,
  ROUTE.forgotPassword.path,
  ROUTE.resetPassword.path,
];

async function sidebarGeometry(page: Page) {
  const header = page.locator('[data-slot="sidebar-header"]');
  const firstNavItem = page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link")
    .first();
  const headerBox = await header.boundingBox();
  const navBox = await firstNavItem.boundingBox();
  if (!headerBox || !navBox) throw new Error("sidebar is not laid out");
  return { headerHeight: headerBox.height, firstNavTop: navBox.y };
}

test.describe("brand", () => {
  for (const path of PUBLIC_PAGES) {
    test(`${path} names ${BRAND_NAME} and not the old product`, async ({
      page,
    }) => {
      await page.goto(path);

      await expect(page.getByText(BRAND_NAME, { exact: true })).toBeVisible();
      await expect(page.locator("body")).not.toContainText(/ticket manager/i);
    });
  }

  test("the static shell is titled with the short name", async ({ page }) => {
    // What a tab reads before any module has run, so it is the served HTML
    // rather than `document.title`, which the app has already rewritten by
    // the time a page can be asked.
    const html = await (await page.request.get("/")).text();
    expect(html).toContain(`<title>${BRAND_SHORT}</title>`);
  });

  test("the favicon is the hallmark SVG", async ({ page }) => {
    await page.goto(ROUTE.login.path);

    const href = await page.locator('link[rel="icon"]').getAttribute("href");
    expect(href).toBeTruthy();

    const icon = await page.request.get(href!);
    expect(icon.ok()).toBe(true);
    expect(icon.headers()["content-type"]).toContain("image/svg+xml");
    expect(await icon.text()).toContain('data-mark="hallmark"');
  });

  test.describe("signed in", () => {
    test.beforeEach(async ({ page }) => {
      await signIn(page, "admin");
    });

    test("a page's tab reads `<page> · Forge Desk`", async ({ page }) => {
      await page.goto(ROUTE.tickets.path);

      await expect(page).toHaveTitle(`Tickets · ${BRAND_SHORT}`);
    });

    test("the sidebar brand is named and holds its place on collapse", async ({
      page,
    }) => {
      const brand = page.getByRole("link", { name: BRAND_NAME, exact: true });
      await expect(brand).toBeVisible();
      await expect(brand).toHaveAttribute("href", ROUTE.dashboard.path);

      const expanded = await sidebarGeometry(page);

      await page.keyboard.press("Control+b");
      await expect(
        page.locator('[data-slot="sidebar"][data-state="collapsed"]'),
      ).toBeVisible();

      // Collapsed it shows only an "F", and keeps the name. `innerText`
      // because the lockup is still in the DOM, only `display: none`.
      await expect(brand).toBeVisible();
      await expect(brand).toHaveText("F", { useInnerText: true });

      const collapsed = await sidebarGeometry(page);
      expect(collapsed.headerHeight).toBe(expanded.headerHeight);
      expect(collapsed.firstNavTop).toBe(expanded.firstNavTop);
    });

    test("page titles are set in the brand face, and it loaded", async ({
      page,
    }) => {
      await page.goto(ROUTE.tickets.path);
      const title = page.getByRole("heading", { level: 1, name: "Tickets" });
      await expect(title).toBeVisible();

      const family = await title.evaluate(
        (el) => getComputedStyle(el).fontFamily,
      );
      expect(family).toMatch(new RegExp(`^"?${BRAND_FAMILY}"?`));

      // `check` alone is not enough: it answers true for a family no
      // @font-face declares at all, since nothing then needs loading. So the
      // face must also be declared and have reached `loaded`.
      const loaded = await page.evaluate(async (brandFamily) => {
        await document.fonts.ready;
        const faces = [...document.fonts].filter(
          (face) => face.family.replace(/["']/g, "") === brandFamily,
        );
        return {
          declared: faces.length > 0,
          anyLoaded: faces.some((face) => face.status === "loaded"),
          check: document.fonts.check(`700 30px "${brandFamily}"`),
        };
      }, BRAND_FAMILY);
      expect(loaded).toEqual({ declared: true, anyLoaded: true, check: true });
    });
  });
});
