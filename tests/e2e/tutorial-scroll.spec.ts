import { test, expect, type Page } from "@playwright/test";
import {
  MESSAGE_DIRECTION,
  TICKET_STATUS,
  TUTORIAL_PAGE_KEY,
  type TutorialStatusResponse,
} from "@ticket/shared";
import { ticketDetailPath } from "../../apps/web/src/lib/routes";
import { signIn } from "./helpers/auth";
import { testDb } from "./helpers/db";

/**
 * A tutorial step scrolls its target into view, and finishing the tutorial
 * must leave the app's frame where it was. The reply composer is the last
 * thing in the ticket detail page, so on a phone `scrollIntoView` cannot
 * centre it inside the page's own scroller and hands the remainder up to
 * `<main>` — which must not be scrollable. Why it was, and the fix, are in
 * the doc comment on `AppShell`.
 */

const PHONE = { width: 390, height: 844 };
const SUBJECT = "E2E tutorial scroll: a long thread";
const CUSTOMER = "e2e-tutorial-scroll@example.com";

test.describe("tutorial scrolling", () => {
  let ticketId: number;

  test.beforeAll(async () => {
    // Enough thread that the composer starts far below a phone's fold.
    const body =
      "A paragraph long enough to wrap a few times on a phone. ".repeat(6);
    const ticket = await testDb.ticket.create({
      data: {
        subject: SUBJECT,
        customerEmail: CUSTOMER,
        customerName: "Tess Scroll",
        status: TICKET_STATUS.Open,
        messages: {
          create: Array.from({ length: 6 }, (_, i) => ({
            messageId: `e2e-tutorial-scroll-${i}@example.com`,
            direction: MESSAGE_DIRECTION.inbound,
            senderEmail: CUSTOMER,
            senderName: "Tess Scroll",
            textBody: body,
          })),
        },
      },
      select: { id: true },
    });
    ticketId = ticket.id;
  });

  test.afterAll(async () => {
    await testDb.ticket.deleteMany({ where: { subject: SUBJECT } });
  });

  async function frameGeometry(page: Page) {
    return page.evaluate(() => {
      const main = document.querySelector("main")!;
      const anchor = document.querySelector('[data-tutorial-anchor="reply"]')!;
      let scroller = anchor.parentElement!;
      while (
        scroller !== main &&
        getComputedStyle(scroller).overflowY !== "auto"
      ) {
        scroller = scroller.parentElement!;
      }
      return {
        mainScrollTop: main.scrollTop,
        pageScrollTop: scroller.scrollTop,
        pageBottom: Math.round(scroller.getBoundingClientRect().bottom),
        viewportHeight: window.innerHeight,
      };
    });
  }

  test("pointing at the reply composer on a phone leaves no gap below the page", async ({
    page,
  }) => {
    const status: TutorialStatusResponse = {
      tutorial: {
        shouldShow: true,
        content: {
          pageKey: TUTORIAL_PAGE_KEY.ticketDetail,
          title: "Ticket detail",
          steps: [{ title: "Reply", body: "Write here.", anchor: "reply" }],
          updatedAt: null,
          updatedByName: null,
        },
      },
    };
    await page.route(
      `**/api/tutorials/${TUTORIAL_PAGE_KEY.ticketDetail}`,
      (r) => r.fulfill({ json: status }),
    );
    await page.setViewportSize(PHONE);
    await signIn(page, "agent");
    await page.goto(ticketDetailPath(ticketId));

    await page.getByRole("button", { name: "Got it" }).click();

    // The page's own scroller did the scrolling it could; wait for it to
    // settle so a smooth scroll still in flight cannot pass the check early.
    let previous = -1;
    await expect
      .poll(async () => {
        const current = (await frameGeometry(page)).pageScrollTop;
        const settled = current > 0 && current === previous;
        previous = current;
        return settled;
      })
      .toBe(true);

    const geometry = await frameGeometry(page);
    expect(geometry.mainScrollTop).toBe(0);
    expect(geometry.pageBottom).toBe(geometry.viewportHeight);
  });
});
