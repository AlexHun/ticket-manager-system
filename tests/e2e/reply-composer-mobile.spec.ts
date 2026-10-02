import { test, expect, type Locator, type Page } from "@playwright/test";
import { MESSAGE_DIRECTION, TICKET_STATUS } from "@ticket/shared";
import { ticketDetailPath } from "../../apps/web/src/lib/routes";
import { signIn } from "./helpers/auth";
import { testDb } from "./helpers/db";

/**
 * The reply composer's action row has to fit a phone. It was one unwrapping
 * flex row, so at 390px "Send reply" ran 16px past the edge, the page
 * scrolled sideways, and the keyboard hint was squeezed one word per line
 * (#397). jsdom has no layout, so only a browser can hold this.
 */

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
/** WCAG 2.5.8's minimum target size, in CSS pixels. */
const MIN_TARGET = 24;
const ACTIONS = ["Polish", "Send & resolve", "Send reply"] as const;
const SUBJECT = "E2E reply composer on a phone";
const CUSTOMER = "e2e-composer-mobile@example.com";
const HINT = "⌘/Ctrl + Enter to send";

async function boxOf(locator: Locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${locator} is not laid out`);
  return box;
}

const action = (page: Page, name: (typeof ACTIONS)[number]) =>
  page.getByRole("button", { name, exact: true });

test.describe("reply composer on a phone", () => {
  let ticketId: number;

  test.beforeAll(async () => {
    const ticket = await testDb.ticket.create({
      data: {
        subject: SUBJECT,
        customerEmail: CUSTOMER,
        customerName: "Pat Phone",
        status: TICKET_STATUS.Open,
        messages: {
          create: {
            messageId: "e2e-composer-mobile-0@example.com",
            direction: MESSAGE_DIRECTION.inbound,
            senderEmail: CUSTOMER,
            senderName: "Pat Phone",
            textBody: "My order has not arrived yet.",
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

  /**
   * Scroll and client widths of the page's own scroller — the composer's
   * nearest scrolling ancestor — and of the document.
   */
  async function pageOverflow(page: Page) {
    const reply = page.getByPlaceholder("Write a reply…");
    return reply.evaluate((textarea) => {
      let scroller = textarea.closest("form")!.parentElement!;
      for (;;) {
        const style = getComputedStyle(scroller);
        if (/auto|scroll/.test(style.overflowX + style.overflowY)) break;
        if (scroller === document.body) {
          throw new Error("the composer has no scrolling ancestor");
        }
        scroller = scroller.parentElement!;
      }
      return {
        scrollWidth: scroller.scrollWidth,
        clientWidth: scroller.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        documentClientWidth: document.documentElement.clientWidth,
      };
    });
  }

  async function expectFitsThePhone(page: Page) {
    const overflow = await pageOverflow(page);
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
    expect(overflow.documentScrollWidth).toBeLessThanOrEqual(
      overflow.documentClientWidth,
    );

    for (const name of ACTIONS) {
      const box = await boxOf(action(page, name));
      expect(box.x, name).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, name).toBeLessThanOrEqual(PHONE.width);
      expect(box.height, name).toBeGreaterThanOrEqual(MIN_TARGET);
    }

    // The hint is a flex item, so the span itself reports one box however
    // many lines it wraps to. A Range over its text reports one rect per
    // line, which is what tells one line from one word per line.
    const hint = page.getByText(HINT);
    await expect(hint).toBeVisible();
    const hintLines = await hint.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return new Set(
        [...range.getClientRects()].map((rect) => Math.round(rect.top)),
      ).size;
    });
    expect(hintLines).toBe(1);
  }

  test("the action row fits at 390px, at rest and with Undo showing", async ({
    page,
  }) => {
    // Stubbed so the test reaches the Undo state without a model call; only
    // the layout after a polish is under test here, not the polish itself.
    await page.route("**/api/ai/polish-reply", (route) =>
      route.fulfill({
        json: { polished: "Thanks for waiting — it ships today." },
      }),
    );
    await page.setViewportSize(PHONE);
    await signIn(page, "agent");
    await page.goto(ticketDetailPath(ticketId));

    const reply = page.getByPlaceholder("Write a reply…");
    await reply.fill("it ships today");
    await expectFitsThePhone(page);

    await action(page, "Polish").click();
    await expect(
      page.getByRole("button", { name: "Undo polish" }),
    ).toBeVisible();
    await expectFitsThePhone(page);
  });

  test("at 1280px the hint and every button still share one row", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    await signIn(page, "agent");
    await page.goto(ticketDetailPath(ticketId));
    await page.getByPlaceholder("Write a reply…").fill("it ships today");

    const centres: number[] = [];
    for (const target of [
      page.getByText(HINT),
      ...ACTIONS.map((name) => action(page, name)),
    ]) {
      const box = await boxOf(target);
      centres.push(box.y + box.height / 2);
    }
    for (const centre of centres) expect(centre).toBeCloseTo(centres[0]!, 0);
  });
});
