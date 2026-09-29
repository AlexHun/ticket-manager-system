import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { MESSAGE_DIRECTION, TICKET_STATUS, USER_ROLE } from "@ticket/shared";
import { ROUTE, ticketDetailPath } from "../../apps/web/src/lib/routes";
import { signIn } from "./helpers/auth";
import { testDb } from "./helpers/db";

/**
 * WCAG AA text contrast on the screens a visitor and an agent see most (#340,
 * the Forge Desk PRD's guardrail metric).
 *
 * Measured by axe-core's `color-contrast` rule rather than a helper over
 * computed colours: axe resolves the backdrop a glyph actually sits on —
 * stacked translucent surfaces, `/60`-style alpha tokens, overlapping layers —
 * which is exactly where a naive `color` vs `background-color` read goes wrong.
 *
 * Each screen tolerates exactly the violations listed by name in `TOLERATED`,
 * and the comparison is `toEqual`, so a new violation fails and so does a
 * fixed one left on the list: the palette slice empties it rather than it
 * quietly going stale. Axe also reports some nodes as *incomplete* — text it
 * cannot judge, which it does not count as a violation. Today that is the
 * sidebar lockup (gradient-clipped text) and the dashboard chart's SVG tick
 * labels; they are not covered here and need eyes when their colours change.
 * Nor is the contrast of control boundaries (WCAG 1.4.11): the rule is text
 * only.
 */

type Screen = "login" | "dashboard" | "tickets" | "ticket detail";

/**
 * A violation the check lets through, matched on a fragment of the element's
 * own markup rather than axe's generated selector — that selector is whatever
 * utility class happens to be unique on the page, so a restyle elsewhere would
 * change it without changing the contrast.
 */
type Tolerated = { name: string; htmlIncludes: string };

const CUSTOMER_EMAIL = "e2e-contrast@example.com";

const TOLERATED: Record<Screen, Tolerated[]> = {
  login: [],
  dashboard: [],
  tickets: [],
  "ticket detail": [
    // 2.28:1 — `text-primary` #006045 on the #161b1d card, needs 4.5:1.
    // TicketDetailPage's customer email link.
    {
      name: "customer email link",
      htmlIncludes: `href="mailto:${CUSTOMER_EMAIL}"`,
    },
  ],
};

let ticketId: number;

test.beforeAll(async () => {
  const ticket = await testDb.ticket.create({
    data: {
      subject: "Contrast check: where is my order",
      customerEmail: CUSTOMER_EMAIL,
      customerName: "Carla Contrast",
      status: TICKET_STATUS.Open,
      messages: {
        create: {
          messageId: `e2e-contrast-${Date.now()}@example.com`,
          direction: MESSAGE_DIRECTION.inbound,
          senderEmail: CUSTOMER_EMAIL,
          senderName: "Carla Contrast",
          textBody: "My order never arrived.",
        },
      },
    },
    select: { id: true },
  });
  ticketId = ticket.id;
});

test.afterAll(async () => {
  await testDb.ticket.deleteMany({ where: { id: ticketId } });
});

async function expectAaContrast(page: Page, screen: Screen): Promise<void> {
  const { violations, passes } = await new AxeBuilder({ page })
    .withRules(["color-contrast"])
    .analyze();

  // A screen that rendered nothing would pass vacuously.
  expect(passes.flatMap((rule) => rule.nodes).length).toBeGreaterThan(0);

  const tolerated = TOLERATED[screen];
  const failing = violations.flatMap((rule) => rule.nodes);
  // Each violation by the name it is tolerated under, or by axe's selector
  // when nothing tolerates it — so an unlisted one fails the comparison.
  const found = failing.map(
    (node) =>
      tolerated.find((t) => node.html.includes(t.htmlIncludes))?.name ??
      `not tolerated: ${node.target.join(" ")}`,
  );
  expect(
    found.sort(),
    failing
      .map((node) => `${node.html}\n${node.failureSummary ?? ""}`)
      .join("\n\n"),
  ).toEqual(tolerated.map((t) => t.name).sort());
}

test.describe("WCAG AA contrast", () => {
  test("login", async ({ page }) => {
    await page.goto(ROUTE.login.path);
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expectAaContrast(page, "login");
  });

  test("dashboard", async ({ page }) => {
    await signIn(page, USER_ROLE.admin);
    // `networkidle` alone can fire before the page has mounted and asked for
    // anything, which scanned an empty screen. Once the heading is up, every
    // panel's fetch is in flight, and idle means their figures have landed.
    await expect(
      page.getByRole("heading", { name: "Dashboard" }),
    ).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expectAaContrast(page, "dashboard");
  });

  test("tickets", async ({ page }) => {
    await signIn(page, USER_ROLE.admin);
    await page.goto(ROUTE.tickets.path);
    await expect(
      page.getByRole("link", { name: /Contrast check/ }).first(),
    ).toBeVisible();
    await expectAaContrast(page, "tickets");
  });

  test("ticket detail", async ({ page }) => {
    await signIn(page, USER_ROLE.admin);
    await page.goto(ticketDetailPath(ticketId));
    await expect(page.getByText("My order never arrived.")).toBeVisible();
    await expect(
      page.getByRole("link", { name: CUSTOMER_EMAIL }),
    ).toBeVisible();
    await expectAaContrast(page, "ticket detail");
  });
});
