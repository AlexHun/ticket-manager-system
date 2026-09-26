import type { Page } from "@playwright/test";
import { ROUTE } from "../../../apps/web/src/lib/routes";
import { freshClientAddress, fromAddress } from "./client-address";

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
