import { test, expect, type Browser, type Page } from "@playwright/test";
import { DEMO_START_LIMIT_MESSAGE } from "@ticket/shared";
import { ROUTE } from "../../apps/web/src/lib/routes";
import { freshClientAddress, fromAddress } from "./helpers/client-address";
import { resetDemoUsers, testDb } from "./helpers/db";
import { API_URL } from "./helpers/env";

/**
 * Five demo starts per address per hour (#322, PRD R9), through the login
 * page against the ordinary :3002 server, at the real default of five.
 *
 * Every request in the suite leaves one machine, so each start here names its
 * client in `X-Forwarded-For` — the header Railway's edge writes and Better
 * Auth's `getIp` reads, with no proxy in front of this API to rewrite it. That
 * gives this file an address nobody else has spent, and gives every other demo
 * spec one too (`helpers/client-address.ts`), so the limit never starves them.
 */

const DEMO_BUTTON = { name: "Use demo session" };

test.beforeEach(async () => {
  await resetDemoUsers();
});

test.afterAll(async () => {
  await resetDemoUsers();
});

const demoCount = () => testDb.user.count({ where: { isAnonymous: true } });

/**
 * A signed-out visitor at `address` clicks the button. A context each, because
 * a signed-in one is sent straight past `/login`.
 */
async function clickDemo(browser: Browser, address: string): Promise<Page> {
  const context = await browser.newContext({
    extraHTTPHeaders: fromAddress(address),
  });
  const page = await context.newPage();
  await page.goto(ROUTE.login.path);
  await page.getByRole("button", DEMO_BUTTON).click();
  return page;
}

test("five starts from one address succeed; the sixth shows the message and creates no user", async ({
  browser,
}) => {
  const address = freshClientAddress();

  for (let start = 1; start <= 5; start += 1) {
    const page = await clickDemo(browser, address);
    await page.waitForURL(ROUTE.dashboard.path);
    await page.context().close();
  }
  expect(await demoCount()).toBe(5);

  const sixth = await clickDemo(browser, address);
  try {
    await expect(sixth.getByRole("alert")).toHaveText(DEMO_START_LIMIT_MESSAGE);
    await expect(sixth).toHaveURL(ROUTE.login.path);
    expect(await demoCount()).toBe(5);
  } finally {
    await sixth.context().close();
  }
});

test("a spent address leaves a visitor on another network alone", async ({
  browser,
  playwright,
}) => {
  // Spent through the API, which is the door the button uses: this test is
  // about the visitor after it, not about the five before. A context per
  // start, for the reason `clickDemo` takes one: the plugin refuses a second
  // anonymous sign-in from a session that is already one.
  const spent = freshClientAddress();
  const start = async () => {
    const api = await playwright.request.newContext({
      extraHTTPHeaders: fromAddress(spent),
    });
    try {
      const res = await api.post(`${API_URL}/api/auth/sign-in/anonymous`);
      return `${res.status()} ${await res.text()}`;
    } finally {
      await api.dispose();
    }
  };
  for (let n = 1; n <= 5; n += 1) expect(await start()).toMatch(/^200 /);
  expect(await start()).toMatch(/^429 /);

  const other = await clickDemo(browser, freshClientAddress());
  try {
    await other.waitForURL(ROUTE.dashboard.path);
    expect(await demoCount()).toBe(6);
  } finally {
    await other.context().close();
  }
});
