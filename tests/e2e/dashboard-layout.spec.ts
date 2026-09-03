import { test, expect, type Page, type Locator } from "@playwright/test";
import {
  DEFAULT_DASHBOARD_LAYOUT,
  type DashboardPanelId,
  type DashboardPanelWidth,
} from "@ticket/shared";
import { CREDENTIALS, signIn } from "./helpers/auth";
import { resetDashboardLayout } from "./helpers/db";
// Plain data modules only (no "@/..." aliases inside them), so importing
// straight from the web app's source is safe here the same way
// `helpers/db.ts` reaches into the API's generated Prisma client.
import { DASHBOARD_PANEL_LABEL } from "../../apps/web/src/lib/dashboard-panels";
import { PANEL_SPAN } from "../../apps/web/src/components/dashboard/grid";

const ADMIN = CREDENTIALS.admin;
const AGENT = CREDENTIALS.agent;

const PANEL_ID_BY_LABEL = new Map<string, DashboardPanelId>(
  Object.entries(DASHBOARD_PANEL_LABEL).map(([id, label]) => [
    label,
    id as DashboardPanelId,
  ]),
);

const FIRST_PANEL = DEFAULT_DASHBOARD_LAYOUT[0]!.panelId;
const LAST_PANEL = DEFAULT_DASHBOARD_LAYOUT[DEFAULT_DASHBOARD_LAYOUT.length - 1]!.panelId;
// statusMix is narrow (the minimum width) and topCustomers is wide (the
// maximum) in the default layout — see DEFAULT_DASHBOARD_LAYOUT in
// packages/shared/src/index.ts.
const NARROWEST_PANEL = DEFAULT_DASHBOARD_LAYOUT.find(
  (p) => p.width === "narrow",
)!.panelId;
const WIDEST_PANEL = DEFAULT_DASHBOARD_LAYOUT.find((p) => p.width === "wide")!
  .panelId;

function label(panelId: DashboardPanelId): string {
  return DASHBOARD_PANEL_LABEL[panelId];
}

async function enterCustomizeMode(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Customize" }).click();
  await expect(
    page.getByRole("button", { name: `Drag to reorder ${label(FIRST_PANEL)}` }),
  ).toBeVisible();
}

/**
 * DOM order of panels, read off the grip handles' `aria-label`s.
 *
 * The toolbar (and its labels) only renders in customize mode, but reading
 * order this way is safe outside of a drag: dnd-kit's `rectSortingStrategy`
 * repositions panels with CSS transforms during a drag, not by moving DOM
 * nodes, and `DashboardPage` renders `layoutData.layout.map(...)` in array
 * order — so the grip handles always appear in the same order as the saved
 * layout.
 */
async function panelOrder(page: Page): Promise<DashboardPanelId[]> {
  const labels = await page
    .getByRole("button", { name: /^Drag to reorder / })
    .evaluateAll((buttons) =>
      buttons.map((b) => b.getAttribute("aria-label") ?? ""),
    );

  return labels.map((text) => {
    const name = text.replace(/^Drag to reorder /, "");
    const id = PANEL_ID_BY_LABEL.get(name);
    if (!id) throw new Error(`Unrecognized panel label in toolbar: "${name}"`);
    return id;
  });
}

/**
 * The panel's own grid-slot wrapper (`DashboardPanelSlot`'s root `<div>`) —
 * reached from its grip handle rather than a dedicated test id, since a
 * panel's width has no accessible representation of its own: it lives only
 * as a Tailwind grid-span class (`PANEL_SPAN`). Only usable in customize
 * mode, since that's the only time the grip handle exists to anchor on.
 */
function panelSlot(page: Page, panelId: DashboardPanelId) {
  return page
    .getByRole("button", { name: `Drag to reorder ${label(panelId)}` })
    .locator(
      'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " relative ")][1]',
    );
}

async function expectWidth(
  page: Page,
  panelId: DashboardPanelId,
  width: DashboardPanelWidth,
): Promise<void> {
  await expect(panelSlot(page, panelId)).toHaveClass(
    new RegExp(PANEL_SPAN[width]),
  );
}

/**
 * The three endpoints the dashboard's route loader primes, and nothing else.
 *
 * Matched on the pathname rather than by glob so the sidebar's own queries
 * (`/api/tickets/views`, `/api/tickets/unread`) and the tutorial's
 * `/api/tutorials/dashboard` can't be caught by accident — every one of them
 * loads alongside this page, and holding them open would be a different test.
 */
const STATS = "/api/tickets/stats";
const EFFECTIVENESS = "/api/tickets/effectiveness";
const LAYOUT = "/api/dashboard-layout";
const LOADER_ENDPOINTS = [STATS, EFFECTIVENESS, LAYOUT] as const;

function isLoaderEndpoint(url: URL): boolean {
  return (LOADER_ENDPOINTS as readonly string[]).includes(url.pathname);
}

/**
 * Record the dashboard skeleton if it is ever mounted, however briefly.
 *
 * Polling for its absence afterwards could only ever miss a flash of it; an
 * observer cannot. `document` rather than `document.body` because this also
 * runs as an init script, before the body exists.
 */
const WATCH_FOR_SKELETON = () => {
  const w = window as Window & { __loadingDashboardSeen?: boolean };
  w.__loadingDashboardSeen = false;
  new MutationObserver(() => {
    if (document.querySelector('[aria-label="Loading dashboard"]')) {
      w.__loadingDashboardSeen = true;
    }
  }).observe(document, { childList: true, subtree: true });
};

function skeletonWasSeen(page: Page): Promise<boolean | undefined> {
  return page.evaluate(
    () =>
      (window as Window & { __loadingDashboardSeen?: boolean })
        .__loadingDashboardSeen,
  );
}

/** The first KPI tile's label — the cheapest proof the real panels, and not the
 * skeleton, are on screen. */
const POPULATED = "Tickets created";

/** Click within a customize-mode control and wait for the save it triggers
 * to round-trip, so a reload immediately afterward can't race the write. */
async function clickAndWaitForSave(
  page: Page,
  locator: Locator,
): Promise<void> {
  await Promise.all([
    page.waitForResponse(
      (res) =>
        res.url().includes("/api/dashboard-layout") &&
        res.request().method() === "PUT",
    ),
    locator.click(),
  ]);
}

// Layout rows are keyed by userId, and the seeded admin/agent are shared
// across the whole suite (unlike the `e2e-`-prefixed throwaway users other
// specs create and sweep) — so every test starts by clearing both, rather
// than relying on whichever test happened to run last having cleaned up.
test.beforeEach(async () => {
  await resetDashboardLayout(ADMIN.email);
  await resetDashboardLayout(AGENT.email);
});

test.afterAll(async () => {
  await resetDashboardLayout(ADMIN.email);
  await resetDashboardLayout(AGENT.email);
});

test.describe("Dashboard panel customization", () => {
  test("renders the default order and widths, with no customize controls until Customize is clicked", async ({
    page,
  }) => {
    await signIn(page, "agent");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(
      page.getByText("Tickets created", { exact: true }),
    ).toBeVisible();

    await expect(
      page.getByRole("button", { name: /^Drag to reorder / }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Move / })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Reset to default" }),
    ).toHaveCount(0);

    await enterCustomizeMode(page);

    expect(await panelOrder(page)).toEqual(
      DEFAULT_DASHBOARD_LAYOUT.map((p) => p.panelId),
    );
    for (const placement of DEFAULT_DASHBOARD_LAYOUT) {
      await expectWidth(page, placement.panelId, placement.width);
    }
    // Nothing to reset — the layout has never been saved for this user.
    await expect(
      page.getByRole("button", { name: "Reset to default" }),
    ).toHaveCount(0);
  });

  test("reordering two panels via the move buttons persists across a reload", async ({
    page,
  }) => {
    await signIn(page, "admin");
    await enterCustomizeMode(page);

    const expectedOrder = DEFAULT_DASHBOARD_LAYOUT.map((p) => p.panelId);
    [expectedOrder[0], expectedOrder[1]] = [expectedOrder[1]!, expectedOrder[0]!];

    await clickAndWaitForSave(
      page,
      page.getByRole("button", { name: `Move ${label(FIRST_PANEL)} later` }),
    );
    expect(await panelOrder(page)).toEqual(expectedOrder);

    await page.reload();
    await enterCustomizeMode(page);
    expect(await panelOrder(page)).toEqual(expectedOrder);
  });

  test("resizing a panel via grow/shrink persists across a reload", async ({
    page,
  }) => {
    await signIn(page, "admin");
    await enterCustomizeMode(page);

    await expectWidth(page, NARROWEST_PANEL, "narrow");
    await clickAndWaitForSave(
      page,
      page.getByRole("button", { name: `Grow ${label(NARROWEST_PANEL)}` }),
    );
    await expectWidth(page, NARROWEST_PANEL, "half");

    await page.reload();
    await enterCustomizeMode(page);
    await expectWidth(page, NARROWEST_PANEL, "half");
  });

  test("a real pointer drag on the grip handle reorders two panels", async ({
    page,
  }) => {
    await signIn(page, "admin");
    await enterCustomizeMode(page);

    const dragPanel = DEFAULT_DASHBOARD_LAYOUT[0]!.panelId;
    const dropTargetPanel = DEFAULT_DASHBOARD_LAYOUT[2]!.panelId;

    const handle = page.getByRole("button", {
      name: `Drag to reorder ${label(dragPanel)}`,
    });
    const targetBox = await panelSlot(page, dropTargetPanel).boundingBox();
    const handleBox = await handle.boundingBox();
    if (!handleBox || !targetBox) {
      throw new Error("Could not measure drag handle or drop target");
    }

    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;
    const endX = targetBox.x + targetBox.width / 2;
    const endY = targetBox.y + targetBox.height / 2;

    const saveResponse = page.waitForResponse(
      (res) =>
        res.url().includes("/api/dashboard-layout") &&
        res.request().method() === "PUT",
    );

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // dnd-kit's PointerSensor only activates a drag past a 4px movement
    // threshold (see DashboardPage's `activationConstraint`) — a single big
    // jump can register as one instantaneous move rather than a drag, so
    // step toward the target in increments to produce genuine intermediate
    // pointermove events.
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(
        startX + ((endX - startX) * i) / steps,
        startY + ((endY - startY) * i) / steps,
      );
    }
    await page.mouse.up();

    await saveResponse;

    const order = await panelOrder(page);
    expect(order.indexOf(dragPanel)).not.toBe(0);
    expect(order).toContain(dragPanel);
    expect(order).toContain(dropTargetPanel);
    expect(order).not.toEqual(DEFAULT_DASHBOARD_LAYOUT.map((p) => p.panelId));

    // Persists across reload too, same as the button-driven reorders.
    await page.reload();
    await enterCustomizeMode(page);
    expect(await panelOrder(page)).toEqual(order);
  });

  test("a saved layout survives sign-out/sign-in and a fresh browser context, and stays independent per user", async ({
    page,
    browser,
  }) => {
    // Agent customizes their own dashboard.
    await signIn(page, "agent");
    await enterCustomizeMode(page);

    const expectedAgentOrder = DEFAULT_DASHBOARD_LAYOUT.map((p) => p.panelId);
    [expectedAgentOrder[0], expectedAgentOrder[1]] = [
      expectedAgentOrder[1]!,
      expectedAgentOrder[0]!,
    ];
    await clickAndWaitForSave(
      page,
      page.getByRole("button", { name: `Move ${label(FIRST_PANEL)} later` }),
    );
    expect(await panelOrder(page)).toEqual(expectedAgentOrder);

    // Sign out and back in as the same user, same tab: still customized.
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL("/login");
    await signIn(page, "agent");
    await enterCustomizeMode(page);
    expect(await panelOrder(page)).toEqual(expectedAgentOrder);

    // A brand-new browser context has no cookies and no localStorage from
    // the tab above — if the layout still shows up here, it can only have
    // come from the server, not client-side storage.
    const freshContext = await browser.newContext();
    try {
      const freshPage = await freshContext.newPage();
      await signIn(freshPage, "agent");
      await enterCustomizeMode(freshPage);
      expect(await panelOrder(freshPage)).toEqual(expectedAgentOrder);

      // A different signed-in user, in the same fresh context, still sees
      // the untouched default — one user's customization doesn't leak.
      await freshPage.getByRole("button", { name: "Sign out" }).click();
      await expect(freshPage).toHaveURL("/login");
      await signIn(freshPage, "admin");
      await enterCustomizeMode(freshPage);
      expect(await panelOrder(freshPage)).toEqual(
        DEFAULT_DASHBOARD_LAYOUT.map((p) => p.panelId),
      );
      await expect(
        freshPage.getByRole("button", { name: "Reset to default" }),
      ).toHaveCount(0);
    } finally {
      await freshContext.close();
    }
  });

  test('"Reset to default" restores the original layout and then disappears', async ({
    page,
  }) => {
    await signIn(page, "admin");
    await enterCustomizeMode(page);

    await clickAndWaitForSave(
      page,
      page.getByRole("button", { name: `Move ${label(FIRST_PANEL)} later` }),
    );
    await clickAndWaitForSave(
      page,
      page.getByRole("button", { name: `Grow ${label(NARROWEST_PANEL)}` }),
    );
    expect(await panelOrder(page)).not.toEqual(
      DEFAULT_DASHBOARD_LAYOUT.map((p) => p.panelId),
    );

    const resetButton = page.getByRole("button", { name: "Reset to default" });
    await expect(resetButton).toBeVisible();
    await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes("/api/dashboard-layout") &&
          res.request().method() === "DELETE",
      ),
      resetButton.click(),
    ]);

    expect(await panelOrder(page)).toEqual(
      DEFAULT_DASHBOARD_LAYOUT.map((p) => p.panelId),
    );
    for (const placement of DEFAULT_DASHBOARD_LAYOUT) {
      await expectWidth(page, placement.panelId, placement.width);
    }
    await expect(resetButton).toHaveCount(0);
  });

  test("move/shrink/grow buttons are disabled at the boundaries", async ({
    page,
  }) => {
    await signIn(page, "admin");
    await enterCustomizeMode(page);

    await expect(
      page.getByRole("button", { name: `Move ${label(FIRST_PANEL)} earlier` }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: `Move ${label(LAST_PANEL)} later` }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: `Shrink ${label(NARROWEST_PANEL)}` }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: `Grow ${label(WIDEST_PANEL)}` }),
    ).toBeDisabled();

    // The non-boundary ends of the same controls stay enabled — proves the
    // `disabled` above is about position/width, not a page-wide state.
    await expect(
      page.getByRole("button", { name: `Move ${label(FIRST_PANEL)} later` }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: `Move ${label(LAST_PANEL)} earlier` }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: `Grow ${label(NARROWEST_PANEL)}` }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: `Shrink ${label(WIDEST_PANEL)}` }),
    ).toBeEnabled();

    // Ordinary buttons — Tab/Enter reaches and activates them like any other
    // control, which is the keyboard-operable equivalent to the drag handle
    // (see DashboardPanelSlot's header comment for why there's no keyboard
    // drag sensor).
    const growNarrowest = page.getByRole("button", {
      name: `Grow ${label(NARROWEST_PANEL)}`,
    });
    await growNarrowest.focus();
    await expect(growNarrowest).toBeFocused();
    await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes("/api/dashboard-layout") &&
          res.request().method() === "PUT",
      ),
      page.keyboard.press("Enter"),
    ]);
    await expectWidth(page, NARROWEST_PANEL, "half");
  });
});

/**
 * Slice 4 of `docs/plans/route-level-data-prefetching.md` — the dashboard's
 * three queries move from mount to navigation time.
 *
 * The claim that is specific to this route, and that the first test exists for,
 * is *parallelism*: the page's three `useQuery` calls are concurrent on mount,
 * so a loader that awaited them one at a time would move the fetch earlier and
 * make it slower. Holding all three open and waiting for all three to be in
 * flight is what a serialized loader could not satisfy.
 */
test.describe("Dashboard prefetching", () => {
  test("starts all three requests at navigation time, in parallel", async ({
    page,
  }) => {
    await signIn(page, "agent");

    // A full document load, which is what makes this test about the loader:
    // signing in already primed these three entries, and a `staleTime` of 30s
    // would have the loader resolve them from cache with no request at all. A
    // new document is a new QueryClient.
    await page.goto("/tickets");
    await expect(page.getByRole("heading", { name: "Tickets" })).toBeVisible();

    // Hold all three responses, which widens the gap between "navigation
    // started" and "data arrived" into something observable. Everything down to
    // the release happens inside that gap.
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(isLoaderEndpoint, async (route) => {
      await held;
      await route.continue();
    });

    await page.evaluate(WATCH_FOR_SKELETON);

    const allThreeInFlight = Promise.all(
      LOADER_ENDPOINTS.map((pathname) =>
        page.waitForRequest((req) => new URL(req.url()).pathname === pathname),
      ),
    );

    await page.getByRole("link", { name: "Dashboard" }).click();

    // All three are on the wire before any of them has answered. Awaited one
    // after another, only the first would exist here and this would time out.
    await allThreeInFlight;

    // And they are on the wire while the tickets list is still the page on
    // screen — the router is holding the navigation until they answer, so the
    // component that used to start them has not mounted and there is no
    // skeleton anywhere.
    await expect(page).toHaveURL("/tickets");
    await expect(page.getByLabel("Loading dashboard")).toHaveCount(0);

    release();

    // The page it hands over to is the populated one — one transition, not a
    // skeleton in between.
    await expect(page).toHaveURL("/");
    await expect(page.getByText(POPULATED, { exact: true })).toBeVisible();
    expect(await skeletonWasSeen(page)).toBe(false);
  });

  test("a bookmarked range arrives already populated", async ({ page }) => {
    await signIn(page, "agent");

    // The cold-entry half of the claim above, and the one that exercises the
    // loader's own reading of the URL: `?range=7d` reaches it through
    // `request.url`, not through the `useSearchParams` the page reads. An init
    // script rather than an `evaluate`, because the document this watches does
    // not exist yet.
    await page.addInitScript(WATCH_FOR_SKELETON);
    await page.goto("/?range=7d");

    await expect(page.getByText(POPULATED, { exact: true })).toBeVisible();
    // The loader and the page agreed on the range, not just on the endpoint:
    // 7d is not the default (90d), so a loader that ignored the query string
    // would have primed the wrong entry and the page would have fetched again.
    await expect(page.getByLabel("Last 7d")).toBeChecked();
    expect(await skeletonWasSeen(page)).toBe(false);
  });

  test("a range change costs one request per endpoint, not two", async ({
    page,
  }) => {
    await signIn(page, "agent");
    await expect(page.getByText(POPULATED, { exact: true })).toBeVisible();

    // Counted from here, so the initial load is not in the total.
    const requests = new Map<string, number>();
    await page.route(isLoaderEndpoint, async (route) => {
      const { pathname } = new URL(route.request().url());
      requests.set(pathname, (requests.get(pathname) ?? 0) + 1);
      await route.continue();
    });

    await page.getByLabel("Last 7d").click();
    await expect(page).toHaveURL("/?range=7d");
    await expect(page.getByText(POPULATED, { exact: true })).toBeVisible();

    // The range change re-runs the loader *and* re-renders the page onto two
    // new query keys: react-query de-duping the two by query hash is the claim
    // this slice inherits from slice 3, and a second request would mean it
    // hadn't. The wait is for a duplicate that would already have been issued —
    // a refetch on a new observer starts with the render that put these panels
    // on screen — so it is a margin, not a race.
    await page.waitForTimeout(300);
    expect(requests.get(STATS)).toBe(1);
    expect(requests.get(EFFECTIVENESS)).toBe(1);

    // The layout query has no params at all, so the same re-run finds an entry
    // that is still fresh (`staleTime: 30_000`) and asks for nothing. Changing
    // the range must not re-fetch a saved panel order that cannot have changed.
    expect(requests.get(LAYOUT)).toBeUndefined();
  });
});
