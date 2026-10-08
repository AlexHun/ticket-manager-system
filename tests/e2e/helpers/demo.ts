import type { Page } from "@playwright/test";
import {
  ADMIN_SCREEN,
  TUTORIAL_PAGE_KEY,
  type AdminScreen,
} from "@ticket/shared";
import { ROUTE } from "../../../apps/web/src/lib/routes";
import { WELCOME_LABEL } from "../../../apps/web/src/lib/welcome";
import { freshClientAddress, fromAddress } from "./client-address";
import { testDb } from "./db";

/** The one control that starts a demo session on `/login`. */
export const DEMO_BUTTON = { name: "Use demo session" };

/**
 * The `GET`s each admin screen sends to draw itself (#369), beside
 * `DEMO_SEES_ADMIN_SCREEN`, which says whether a demo visitor sees the screen.
 * The screens it says `true` for are where `showcaseReads` takes the demo
 * spec's showcase reads from.
 *
 * Users and Outbox are listed too, though a demo sees neither: should the table
 * ever open one, its reads join the showcase at once, and the spec's literal
 * 403s for them go red beside it. The demo usage figures drawn on Users are
 * not here, for `apps/api/src/test/boundary.ts`'s reason: they stay admin
 * only whatever the table says.
 *
 * Typed as a `Record`, but nothing typechecks this directory, so
 * `showcaseReads` makes the same demand at run time. Not the API's
 * `screenReads`: that one registers a router's unit tests, and this one only
 * lists paths.
 */
export const ADMIN_SCREEN_READS: Record<AdminScreen, readonly string[]> = {
  [ADMIN_SCREEN.users]: ["/api/users"],
  [ADMIN_SCREEN.knowledge]: [
    "/api/knowledge-articles",
    "/api/knowledge-articles/pending-revisions",
  ],
  [ADMIN_SCREEN.outbox]: ["/api/outbox"],
  [ADMIN_SCREEN.pipeline]: ["/api/pipeline", "/api/automation"],
  [ADMIN_SCREEN.evals]: ["/api/evals/runs", "/api/evals/schedule"],
  [ADMIN_SCREEN.activity]: ["/api/activity"],
  [ADMIN_SCREEN.tutorials]: ["/api/tutorials"],
};

/**
 * Every read a demo visitor must be able to send: the `reads` of each screen
 * `seen` opens. Any screen in `seen` with no reads listed throws by name, open
 * or not, so a screen added to the table cannot slip past the spec with
 * nothing asserted. Keyed by `string` rather than `AdminScreen` so the spec can
 * hand it a screen the table does not have.
 */
export function showcaseReads(
  seen: Readonly<Record<string, boolean>>,
  reads: Readonly<Partial<Record<string, readonly string[]>>>,
): string[] {
  return Object.entries(seen).flatMap(([screen, open]) => {
    const paths = reads[screen] ?? [];
    if (paths.length === 0) {
      throw new Error(
        `the ${screen} screen is in DEMO_SEES_ADMIN_SCREEN and ADMIN_SCREEN_READS lists none of its reads`,
      );
    }
    return open ? paths : [];
  });
}

/**
 * Click the button and wait to land on the welcome (demo-welcome R1). From an
 * address of its own, so a spec's starts never add up to the five-an-hour
 * limit (#322) — that is `demo-rate-limit.spec.ts`'s subject, not the caller's.
 */
export async function startDemoOnWelcome(page: Page): Promise<void> {
  await page.context().setExtraHTTPHeaders(fromAddress(freshClientAddress()));
  await page.goto(ROUTE.login.path);
  await page.getByRole("button", DEMO_BUTTON).click();
  await page.waitForURL(ROUTE.welcome.path);
}

/**
 * Start a demo and go on from the welcome to the dashboard, as a visitor who
 * clicks Start exploring does — where every demo spec but the welcome's own
 * begins.
 */
export async function startDemo(page: Page): Promise<void> {
  await startDemoOnWelcome(page);
  await page.getByRole("link", { name: WELCOME_LABEL.startExploring }).click();
  await page.waitForURL(ROUTE.dashboard.path);
}

/**
 * Write a one-step Dashboard walkthrough titled `title`, so a demo visitor has
 * a Tutorial to meet there, and return what puts back whatever was there. The
 * test database holds no tutorial copy (the seed writes none), which is what
 * keeps every other spec free of pop-ups. Call it in `beforeAll` and the
 * returned function in `afterAll`; `workers: 1` keeps two specs from sharing
 * the row at once.
 */
export async function writeDashboardWalkthrough(
  title: string,
): Promise<() => Promise<void>> {
  const pageKey = TUTORIAL_PAGE_KEY.dashboard;
  const saved = await testDb.tutorialContent.findUnique({
    where: { pageKey },
  });
  const steps = [{ title: "The dashboard", body: "Everything at a glance." }];
  await testDb.tutorialContent.upsert({
    where: { pageKey },
    create: { pageKey, title, steps },
    update: { title, steps },
  });

  return async () => {
    if (saved) {
      const { title, steps, updatedById, updatedByName } = saved;
      await testDb.tutorialContent.update({
        where: { pageKey },
        data: { title, steps: steps ?? [], updatedById, updatedByName },
      });
    } else {
      await testDb.tutorialContent.deleteMany({ where: { pageKey } });
    }
  };
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
