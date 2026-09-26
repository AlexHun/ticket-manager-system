import type { Page } from "@playwright/test";
import { ROUTE } from "../../../apps/web/src/lib/routes";
import { freshClientAddress, fromAddress } from "./client-address";
import { testDb } from "./db";

/** The one control that starts a demo session on `/login`. */
export const DEMO_BUTTON = { name: "Use demo session" };

/**
 * Click the button and wait to land on the dashboard. From an address of its
 * own, so a spec's starts never add up to the five-an-hour limit (#322) —
 * that is `demo-rate-limit.spec.ts`'s subject, not the caller's.
 */
export async function startDemo(page: Page): Promise<void> {
  await page.context().setExtraHTTPHeaders(fromAddress(freshClientAddress()));
  await page.goto(ROUTE.login.path);
  await page.getByRole("button", DEMO_BUTTON).click();
  await page.waitForURL(ROUTE.dashboard.path);
}

/**
 * Put this page's session two hours behind it, in the database (#324), by
 * either of the two things that end one:
 *
 * - `expiresAt` — its end moved into the past, which Better Auth refuses by
 *   itself;
 * - `createdAt` — its start moved over two hours back while its row still
 *   says it has time left, as a session opened before the two-hour rule does.
 *   Only `auth.ts`'s own rule refuses that one, with a 401.
 *
 * The row is found by the token in the page's own session cookie, which
 * Better Auth signs as `<token>.<signature>`.
 */
export async function backdateDemoSession(
  page: Page,
  column: "expiresAt" | "createdAt",
): Promise<void> {
  const cookie = (await page.context().cookies()).find((c) =>
    c.name.endsWith("session_token"),
  );
  if (!cookie) throw new Error("the page holds no session cookie");
  const token = decodeURIComponent(cookie.value).split(".")[0] ?? "";

  const twoHoursAndASecond = (2 * 60 * 60 + 1) * 1000;
  const { count } = await testDb.session.updateMany({
    where: { token },
    data:
      column === "expiresAt"
        ? { expiresAt: new Date(Date.now() - 1000) }
        : { createdAt: new Date(Date.now() - twoHoursAndASecond) },
  });
  if (count !== 1) throw new Error(`expected one session row, found ${count}`);
}

/**
 * Let the 60-second session cookie cache lapse, without the minute's wait.
 *
 * A request the cache answers never reads the session row, so a row changed
 * behind its back goes on being served from it until it lapses (measured in
 * `apps/api/src/routes/users.test.ts`). The browser drops the cookie itself at
 * its 60-second `maxAge`, so removing it is that minute passing.
 */
export async function lapseSessionCache(page: Page): Promise<void> {
  await page.context().clearCookies({ name: /session_data$/ });
}
