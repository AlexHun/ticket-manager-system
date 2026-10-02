import { test, expect, type Page } from "@playwright/test";
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

const PHONE = { width: 390, height: 844 };
const SUBJECT = "E2E reply composer on a phone";
const CUSTOMER = "e2e-composer-mobile@example.com";
const HINT = "⌘/Ctrl + Enter to send";

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
    await testDb.ticket.deleteMany({ where: { subject: SUBJECT } });
  });

  /** The nearest scrolling ancestor of the composer: the page's own scroller. */
  async function pageOverflow(page: Page) {
    return page.evaluate(() => {
      const form = document.querySelector("form:has(textarea)")!;
      let scroller = form.parentElement!;
      while (scroller !== document.body) {
        const style = getComputedStyle(scroller);
        if (/auto|scroll/.test(style.overflowX + style.overflowY)) break;
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

    for (const name of ["Polish", "Send & resolve", "Send reply"]) {
      const box = await page
        .getByRole("button", { name, exact: true })
        .boundingBox();
      expect(box, name).not.toBeNull();
      expect(box!.x, name).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, name).toBeLessThanOrEqual(PHONE.width);
      expect(box!.height, name).toBeGreaterThanOrEqual(24);
    }

    // One line box, or not rendered at all — never one word per line.
    const hintLines = await page
      .getByText(HINT)
      .evaluate((el) => el.getClientRects().length);
    expect(hintLines).toBeLessThanOrEqual(1);
  }

  test("the action row fits at 390px, at rest and with Undo showing", async ({
    page,
  }) => {
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

    await page.getByRole("button", { name: "Polish", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Undo polish" }),
    ).toBeVisible();
    await expectFitsThePhone(page);
  });

  test("at 1280px the hint and every button still share one row", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await signIn(page, "agent");
    await page.goto(ticketDetailPath(ticketId));
    await page.getByPlaceholder("Write a reply…").fill("it ships today");

    const centres: number[] = [];
    for (const target of [
      page.getByText(HINT),
      page.getByRole("button", { name: "Polish", exact: true }),
      page.getByRole("button", { name: "Send & resolve", exact: true }),
      page.getByRole("button", { name: "Send reply", exact: true }),
    ]) {
      const box = (await target.boundingBox())!;
      centres.push(box.y + box.height / 2);
    }
    for (const centre of centres) expect(centre).toBeCloseTo(centres[0]!, 0);
  });
});
