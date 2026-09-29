import { test, expect, type Locator, type Page } from "@playwright/test";
import {
  MESSAGE_DIRECTION,
  TICKET_STATUS,
  TUTORIAL_PAGE_KEY,
  type TutorialStatusResponse,
} from "@ticket/shared";
import { CREDENTIALS, signIn } from "./helpers/auth";
import { testDb } from "./helpers/db";
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

/**
 * Slice 2 (#342): Cold iron, and each colour keeps one meaning. Temper blue is
 * whatever you can act on, verdigris is settled, bronze only decorates, and
 * the ember ramp still means somebody is waiting.
 *
 * Colours are compared as hues rather than as token strings, so the check is
 * about what a person sees: every computed colour is painted onto a 1×1
 * canvas, read back as sRGB and converted to OKLCH here. The families are
 * wide on purpose — a retune inside one should not fail this, a colour moving
 * to another family should.
 */
type Oklch = { l: number; c: number; h: number };

/** Hue windows, in OKLCH degrees, for the families that carry meaning. */
const HUE = {
  temper: [225, 275],
  // The old calm was emerald at 163°; verdigris sits past it toward cyan.
  verdigris: [170, 195],
} as const;

/**
 * The ember ramp as it was before this slice, held as literals rather than
 * read from the stylesheet: the claim is that the palette moved around it.
 */
const EMBER_RAMP_BEFORE = [
  "oklch(0.85 0.14 85)",
  "oklch(0.68 0.19 45)",
  "oklch(0.62 0.21 25)",
];

const UNREAD_SUBJECT = `Cold iron unread ${Date.now()}`;
const RESOLVED_SUBJECT = `Cold iron resolved ${Date.now()}`;

function toOklch([r, g, b]: number[]): Oklch {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [lr, lg, lb] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(
    0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb,
  );
  const m = Math.cbrt(
    0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb,
  );
  const s = Math.cbrt(
    0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb,
  );
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const h = (Math.atan2(B, A) * 180) / Math.PI;
  return { l: L, c: Math.hypot(A, B), h: (h + 360) % 360 };
}

/** One computed colour property of an element, as OKLCH. */
async function colourOf(
  locator: Locator,
  property: "color" | "backgroundColor",
): Promise<Oklch> {
  const rgb = await locator.evaluate((el, prop) => {
    const ctx = document.createElement("canvas").getContext("2d")!;
    ctx.fillStyle = getComputedStyle(el)[prop];
    ctx.fillRect(0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)];
  }, property);
  return toOklch(rgb);
}

function expectFamily(colour: Oklch, family: keyof typeof HUE): void {
  const [from, to] = HUE[family];
  // A near-grey has no meaningful hue, so it cannot be in a family at all.
  expect(colour.c, `${family} needs chroma`).toBeGreaterThan(0.04);
  expect(colour.h, `${family} hue`).toBeGreaterThanOrEqual(from);
  expect(colour.h, `${family} hue`).toBeLessThanOrEqual(to);
}

test.describe("Cold iron", () => {
  test.beforeAll(async () => {
    const agent = await testDb.user.findUniqueOrThrow({
      where: { email: CREDENTIALS.agent.email },
      select: { id: true },
    });
    const ticket = (subject: string) => ({
      subject,
      customerEmail: "e2e-cold-iron@example.com",
      customerName: "Cole Iron",
      messages: {
        create: {
          messageId: `e2e-${subject.replace(/\W+/g, "-")}@example.com`,
          direction: MESSAGE_DIRECTION.inbound,
          senderEmail: "e2e-cold-iron@example.com",
          senderName: "Cole Iron",
          textBody: "Colour check.",
        },
      },
    });
    // Assigned and never opened, so the agent's sidebar carries a count.
    await testDb.ticket.create({
      data: {
        ...ticket(UNREAD_SUBJECT),
        status: TICKET_STATUS.Open,
        assignedToId: agent.id,
      },
    });
    await testDb.ticket.create({
      data: { ...ticket(RESOLVED_SUBJECT), status: TICKET_STATUS.Resolved },
    });
  });

  test.afterAll(async () => {
    await testDb.ticket.deleteMany({
      where: { subject: { in: [UNREAD_SUBJECT, RESOLVED_SUBJECT] } },
    });
  });

  test("the unread count and a primary button are temper blue", async ({
    page,
  }) => {
    // The tickets page has no primary button at rest; its tutorial callout's
    // does. The test database holds no tutorial copy, and seeding one would
    // pop it on every spec that visits this page, so this page alone is told
    // there is one to show.
    const status: TutorialStatusResponse = {
      tutorial: {
        shouldShow: true,
        content: {
          pageKey: TUTORIAL_PAGE_KEY.tickets,
          title: "Tickets",
          steps: [{ title: "The queue", body: "Colour check." }],
          updatedAt: null,
          updatedByName: null,
        },
      },
    };
    await page.route(`**/api/tutorials/${TUTORIAL_PAGE_KEY.tickets}`, (r) =>
      r.fulfill({ json: status }),
    );
    await signIn(page, "agent");
    await page.goto(ROUTE.tickets.path);

    // By markup rather than role: the callout is modal, so everything behind
    // it, the sidebar included, is out of the accessibility tree.
    // The saved views below carry counts of their own; this is the one on the
    // Tickets item, whose link is the bare path.
    const unread = page
      .locator('[data-sidebar="menu-item"]')
      .filter({ has: page.locator(`a[href="${ROUTE.tickets.path}"]`) })
      .locator('[data-sidebar="menu-badge"]');
    await expect(unread).toHaveText(/^\d+$/);
    const primary = page.getByRole("button", { name: "Got it" });
    await expect(primary).toBeVisible();

    expectFamily(await colourOf(unread, "backgroundColor"), "temper");
    expectFamily(await colourOf(primary, "backgroundColor"), "temper");
  });

  test("a resolved status badge is verdigris", async ({ page }) => {
    await signIn(page, "agent");
    await page.goto(
      `${ROUTE.tickets.path}?q=${encodeURIComponent(RESOLVED_SUBJECT)}`,
    );

    const badge = page
      .getByRole("row", { name: new RegExp(RESOLVED_SUBJECT) })
      .getByText(TICKET_STATUS.Resolved, { exact: true });
    await expect(badge).toBeVisible();

    expectFamily(await colourOf(badge, "color"), "verdigris");
  });

  test("the ember ramp is the colour it was", async ({ page }) => {
    await signIn(page, "agent");
    await page.goto(ROUTE.tickets.path);

    // Computed through a real element, so a token that now resolves somewhere
    // else — a `var()` left pointing at a moved one — shows up here.
    const ramp = await page.evaluate(() =>
      [1, 2, 3].map((step) => {
        const probe = document.createElement("i");
        probe.style.color = `var(--ember-${step})`;
        document.body.append(probe);
        const colour = getComputedStyle(probe).color;
        probe.remove();
        return colour;
      }),
    );
    expect(ramp).toEqual(EMBER_RAMP_BEFORE);
  });

  test("nothing clickable, counted or stated is bronze", async ({ page }) => {
    await signIn(page, "agent");
    await page.goto(ROUTE.tickets.path);
    await expect(
      page.getByRole("link", { name: new RegExp(UNREAD_SUBJECT) }).first(),
    ).toBeVisible();

    const offenders = await page.evaluate(() => {
      const probe = document.createElement("i");
      probe.style.color = "var(--bronze)";
      document.body.append(probe);
      const bronze = getComputedStyle(probe).color;
      probe.remove();

      const controls = document.querySelectorAll(
        'a, button, [role="button"], [role="combobox"], [data-slot="badge"], [data-sidebar="menu-badge"]',
      );
      const found: string[] = [];
      for (const control of controls) {
        for (const el of [control, ...control.querySelectorAll("*")]) {
          const style = getComputedStyle(el);
          for (const value of [
            style.color,
            style.backgroundColor,
            style.borderTopColor,
            style.outlineColor,
            style.fill,
            style.stroke,
          ]) {
            if (value === bronze) found.push(control.outerHTML.slice(0, 120));
          }
        }
      }
      return {
        bronze,
        inherited: getComputedStyle(document.body).color,
        found,
      };
    });
    // An undefined `--bronze` falls back to the inherited colour, and then
    // every comparison above is against the body text instead.
    expect(offenders.bronze).not.toBe(offenders.inherited);
    expect(offenders.found).toEqual([]);
  });
});
