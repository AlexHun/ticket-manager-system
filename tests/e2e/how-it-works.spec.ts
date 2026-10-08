import { test, expect, type Locator, type Page } from "@playwright/test";
import {
  NEW_FEATURE_KEY,
  TICKET_STATUS,
  USER_ROLE,
  type UserRole,
} from "@ticket/shared";
import { CREDENTIALS, signIn } from "./helpers/auth";
import { resetNewFeatureSeen, resetTickets, testDb } from "./helpers/db";
// The titles and labels under test come from the module the page draws them
// from, as `route-timing.spec.ts` reads `routes.ts`: both are import-free, so
// this reaches into the web app's source without pulling React in.
import {
  ARCHITECTURE_EDGES,
  ARCHITECTURE_NODE,
  ARCHITECTURE_NODES,
  RAILWAY_FRAME,
  SHARED_PACKAGES_NOTE,
  architectureNode,
} from "../../apps/web/src/lib/how-it-works/architecture";
import {
  GRAPH_CODE_ATTRIBUTE,
  GRAPH_EDGE_ATTRIBUTE,
  GRAPH_EMPHASIS,
  GRAPH_EMPHASIS_ATTRIBUTE,
  GRAPH_GLIDE_MS,
  GRAPH_LANE_ATTRIBUTE,
  GRAPH_NODE_ATTRIBUTE,
  GRAPH_NOTE_ATTRIBUTE,
  GRAPH_SCREEN_ATTRIBUTE,
  GRAPH_STATUS_STRIP_ATTRIBUTE,
  GRAPH_STATUS_TAG_ATTRIBUTE,
  GRAPH_VIEWPORT_ATTRIBUTE,
  HOW_IT_WORKS_LABEL,
} from "../../apps/web/src/lib/how-it-works/dom";
import {
  LIFECYCLE_BRANCHES,
  LIFECYCLE_EDGES,
  LIFECYCLE_NOTES,
  LIFECYCLE_STEP,
  LIFECYCLE_STEPS,
  NO_TICKET_YET,
  lifecycleStep,
  type LifecycleStepId,
} from "../../apps/web/src/lib/how-it-works/lifecycle";
import { contains } from "../../apps/web/src/lib/how-it-works/layout";
import { subsystemLinkId } from "../../apps/web/src/lib/how-it-works/subsystem-layout";
import { subsystemsOf } from "../../apps/web/src/lib/how-it-works/subsystems";
import { ROUTE } from "../../apps/web/src/lib/routes";

/**
 * `docs/plans/how-it-works.md`, slices 1 to 6 (#455, #456, #457, #458, #459,
 * #460): the nav item, the Architecture view's runtime boxes on a zoomable
 * canvas and the subsystems they open onto, the Ticket lifecycle in its
 * swimlanes, walking it step by step, the panel with its way into the code,
 * and the zoom buttons and the page's layout on a phone. Every
 * test runs against an empty ticket table, because the page reads no ticket
 * data (R12).
 */

/**
 * What the shell around every page reads — the sidebar's unread count and its
 * saved views. They are not this page's, and it must add none of its own.
 */
const SHELL_TICKET_READS = ["/api/tickets/unread", "/api/tickets/views"];

const navLink = (page: Page) =>
  page.getByRole("link", { name: "How it works" });

const newBadge = (page: Page) =>
  page
    .getByRole("listitem")
    .filter({ has: navLink(page) })
    .getByTestId("new-feature-badge");

const nodeBox = (page: Page, id: string) =>
  page.locator(`[${GRAPH_NODE_ATTRIBUTE}="${id}"]`);

const subsystemDrawing = (page: Page) =>
  page.getByRole("group", { name: HOW_IT_WORKS_LABEL.subsystemCanvas });

async function boxPositions(page: Page) {
  const positions: Record<string, unknown> = {};
  for (const node of ARCHITECTURE_NODES) {
    positions[node.id] = await nodeBox(page, node.id).boundingBox();
  }
  return positions;
}

/** Text with its whitespace gone: SVG text drawn in wrapped lines loses its
 *  spaces at each break, so a drawn label is compared word for word. */
const squash = (text: string | null) => (text ?? "").replace(/\s+/g, "");

async function openLifecycle(page: Page) {
  await page
    .getByRole("tab", { name: HOW_IT_WORKS_LABEL.lifecycleTab })
    .click();
  await expect(
    page.getByRole("group", { name: HOW_IT_WORKS_LABEL.lifecycleCanvas }),
  ).toBeVisible();
}

async function stepPositions(page: Page) {
  const positions: Record<string, unknown> = {};
  for (const step of LIFECYCLE_STEPS) {
    positions[step.id] = await nodeBox(page, step.id).boundingBox();
  }
  return positions;
}

/**
 * Every box or step on the drawing in the drawing's own coordinates — its bounding box, and
 * any transform between it and the view's `<g>` — which the view transform
 * does not reach: what has to hold still while the view moves (R9).
 */
function nodeGeometry(page: Page) {
  return page.locator(`[${GRAPH_NODE_ATTRIBUTE}]`).evaluateAll(
    (nodes, [nodeAttribute, viewportAttribute]) => {
      const viewport = document.querySelector<SVGGElement>(
        `[${viewportAttribute}]`,
      )!;
      return nodes.map((node) => {
        const element = node as SVGGraphicsElement;
        const { x, y, width, height } = element.getBBox();
        const { a, b, c, d, e, f } = viewport
          .getCTM()!
          .inverse()
          .multiply(element.getCTM()!);
        return [
          node.getAttribute(nodeAttribute),
          [x, y, width, height],
          // Rounded past float noise, and `+ 0` turns a -0 into 0.
          [a, b, c, d, e, f].map((n) => Math.round(n * 1000) / 1000 + 0),
        ];
      });
    },
    [GRAPH_NODE_ATTRIBUTE, GRAPH_VIEWPORT_ATTRIBUTE] as const,
  );
}

/** The step the walk is on is the one pressed and emphasised, and no other. */
async function expectCurrent(page: Page, id: LifecycleStepId) {
  for (const step of LIFECYCLE_STEPS) {
    const box = nodeBox(page, step.id);
    const current = step.id === id;
    await expect(box, step.id).toHaveAttribute("aria-pressed", String(current));
    await expect(box, step.id).toHaveAttribute(
      GRAPH_EMPHASIS_ATTRIBUTE,
      current ? GRAPH_EMPHASIS.current : GRAPH_EMPHASIS.dimmed,
    );
  }
  const list = page.getByRole("list", {
    name: HOW_IT_WORKS_LABEL.lifecycleList,
  });
  await expect(list.locator('> li[aria-current="step"]')).toHaveText(
    new RegExp(`^${lifecycleStep(id).title} `),
  );
}

/**
 * Zooms the lifecycle in about its right-hand side until the first step has
 * left the frame, and returns what a stepping test reads: the canvas's area,
 * the view's `<g>`, the first step's box and the transform once zoomed.
 */
async function zoomPastFirstStep(page: Page) {
  const canvas = page.getByRole("group", {
    name: HOW_IT_WORKS_LABEL.lifecycleCanvas,
  });
  const area = (await canvas.boundingBox())!;
  const viewport = canvas.locator(`[${GRAPH_VIEWPORT_ATTRIBUTE}]`);
  const first = nodeBox(page, LIFECYCLE_STEPS[0]!.id);
  await page.mouse.move(area.x + area.width * 0.9, area.y + area.height / 2);
  await page.mouse.wheel(0, -600);
  // Polled: one wheel can reach the page as several events.
  await expect
    .poll(async () => contains(area, (await first.boundingBox())!))
    .toBe(false);
  const zoomed = await viewport.getAttribute("transform");
  return { area, viewport, first, zoomed };
}

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 375, height: 812 };
/** Sub-pixel slack for comparing box edges. */
const SLACK = 2;

const details = (page: Page) =>
  page.getByRole("region", { name: HOW_IT_WORKS_LABEL.details });

async function boxOf(locator: Locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${locator} is not laid out`);
  return box;
}

/**
 * How far the element sits in from the left and right of the content area:
 * the page's own scroller, short of any scrollbar it shows.
 */
async function insetFromContent(page: Page, locator: Locator) {
  const box = await boxOf(locator);
  const area = await pageScroller(page).evaluate((scroller) => {
    const left = scroller.getBoundingClientRect().left + scroller.clientLeft;
    return { left, right: left + scroller.clientWidth };
  });
  return {
    left: box.x - area.left,
    right: area.right - (box.x + box.width),
  };
}

/** The page root: the nearest ancestor of the page's heading that scrolls. */
const pageScroller = (page: Page) =>
  page
    .getByRole("heading", { level: 1 })
    .locator(
      "xpath=ancestor::*[contains(concat(' ', @class, ' '), ' overflow-y-auto ')][1]",
    );

/** Whether the window, or the page's own scroller, can scroll sideways. */
function sidewaysScroll(page: Page) {
  return pageScroller(page).evaluate((scroller) => {
    const root = document.documentElement;
    return {
      window: root.scrollWidth > root.clientWidth,
      page: scroller.scrollWidth > scroller.clientWidth,
    };
  });
}

/**
 * Whether any ancestor that clips its overflow cuts the element off at the
 * left or right. Only sideways: the page scrolls, so what is below the fold
 * is not clipped.
 */
function clipped(locator: Locator) {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    for (
      let ancestor = element.parentElement;
      ancestor;
      ancestor = ancestor.parentElement
    ) {
      if (getComputedStyle(ancestor).overflowX === "visible") continue;
      const frame = ancestor.getBoundingClientRect();
      if (rect.left < frame.left - 1 || rect.right > frame.right + 1) {
        return true;
      }
    }
    return false;
  });
}

test.describe("How it works", () => {
  test.beforeEach(async () => {
    await resetTickets();
    await resetNewFeatureSeen(
      CREDENTIALS[USER_ROLE.agent].email,
      NEW_FEATURE_KEY.howItWorks,
    );
  });

  test("an agent finds it in the sidebar, badged New until they first follow it", async ({
    page,
  }) => {
    await signIn(page, USER_ROLE.agent);

    await expect(newBadge(page)).toBeVisible();

    const seen = page.waitForResponse(
      (response) =>
        response
          .url()
          .endsWith(`/api/new-features/${NEW_FEATURE_KEY.howItWorks}/seen`) &&
        response.ok(),
    );
    await navLink(page).click();
    await page.waitForURL(ROUTE.howItWorks.path);
    await seen;
    await expect(
      page.getByRole("heading", { level: 1, name: "How it works" }),
    ).toBeVisible();

    await page.reload();
    await expect(navLink(page)).toBeVisible();
    await expect(newBadge(page)).toHaveCount(0);
  });

  test("draws every runtime box and connection from an empty desk, reading no tickets", async ({
    page,
  }) => {
    expect(await testDb.ticket.count()).toBe(0);
    await signIn(page, USER_ROLE.agent);

    const ticketReads: string[] = [];
    page.on("request", (request) => {
      const { pathname } = new URL(request.url());
      if (
        pathname.startsWith("/api/tickets") &&
        !SHELL_TICKET_READS.includes(pathname)
      ) {
        ticketReads.push(pathname);
      }
    });

    await page.goto(ROUTE.howItWorks.path);
    await expect(
      page.getByRole("tab", { name: HOW_IT_WORKS_LABEL.architectureTab }),
    ).toHaveAttribute("aria-selected", "true");

    for (const node of ARCHITECTURE_NODES) {
      await expect(nodeBox(page, node.id)).toBeVisible();
      await expect(nodeBox(page, node.id)).toContainText(node.title);
    }
    for (const edge of ARCHITECTURE_EDGES) {
      const connection = page.locator(`[${GRAPH_EDGE_ATTRIBUTE}="${edge.id}"]`);
      await expect(connection).toBeVisible();
      await expect(connection).toContainText(edge.label);
    }
    const canvas = page.getByRole("group", {
      name: HOW_IT_WORKS_LABEL.architectureCanvas,
    });
    await expect(
      canvas.getByText(RAILWAY_FRAME.title, { exact: true }),
    ).toBeVisible();
    await expect(
      canvas.getByText(SHARED_PACKAGES_NOTE.title, { exact: true }),
    ).toBeVisible();

    // The other tab reads nothing either.
    await openLifecycle(page);
    await expect(nodeBox(page, LIFECYCLE_STEP.agentCloses)).toBeVisible();

    expect(ticketReads).toEqual([]);
  });

  test("selecting a box puts its explanation in the panel", async ({
    page,
  }) => {
    await signIn(page, USER_ROLE.agent);
    await page.goto(ROUTE.howItWorks.path);

    const api = architectureNode(ARCHITECTURE_NODE.api);
    const panel = page.getByRole("region", {
      name: HOW_IT_WORKS_LABEL.details,
    });
    await expect(panel).not.toContainText(api.explanation);

    await page.getByRole("button", { name: api.title, exact: true }).click();

    await expect(panel).toContainText(api.title);
    await expect(panel).toContainText(api.explanation);
  });

  test("the API opens onto its subsystems, none of them a file, and Back returns to the boxes where they were", async ({
    page,
  }) => {
    await signIn(page, USER_ROLE.agent);
    await page.goto(ROUTE.howItWorks.path);
    await expect(nodeBox(page, ARCHITECTURE_NODE.api)).toBeVisible();

    // Zoomed first, so coming back has a view to keep as well as the boxes.
    const canvas = page.getByRole("group", {
      name: HOW_IT_WORKS_LABEL.architectureCanvas,
    });
    const viewport = canvas.locator(`[${GRAPH_VIEWPORT_ATTRIBUTE}]`);
    const area = (await canvas.boundingBox())!;
    await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
    await page.mouse.wheel(0, -200);
    await expect(viewport).toHaveAttribute("transform", /scale\(/);
    // Polled until the wheel's events have all landed.
    let view: string | null = null;
    await expect
      .poll(async () => {
        const settled = view;
        view = await viewport.getAttribute("transform");
        return view === settled;
      })
      .toBe(true);
    // The view, and every box in the drawing's own coordinates rather than
    // the screen's: a selected box's thicker outline moves its screen box.
    const where = async () => ({
      view: await viewport.getAttribute("transform"),
      nodes: await nodeGeometry(page),
    });
    const before = await where();

    const api = architectureNode(ARCHITECTURE_NODE.api);
    await page.getByRole("button", { name: api.title, exact: true }).click();

    const drawing = subsystemDrawing(page);
    await expect(drawing).toBeVisible();
    for (const subsystem of subsystemsOf(ARCHITECTURE_NODE.api)) {
      const node = drawing.locator(
        `[${GRAPH_NODE_ATTRIBUTE}="${subsystem.id}"]`,
      );
      await expect(node).toBeVisible();
      await expect(node).toHaveText(subsystem.title);
      // Each one joined to what it talks to in the other boxes.
      for (const link of subsystem.links) {
        await expect(
          drawing.locator(
            `[${GRAPH_EDGE_ATTRIBUTE}="${subsystemLinkId(subsystem.id, link.part)}"]`,
          ),
        ).toBeAttached();
      }
    }
    // No node on the drawing is titled with a path or a file name.
    for (const title of await drawing
      .locator(`[${GRAPH_NODE_ATTRIBUTE}]`)
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-label")))) {
      expect(title).not.toMatch(/[\\/]|\.[a-z]{1,4}$/i);
    }

    await page
      .getByRole("button", { name: HOW_IT_WORKS_LABEL.backToRuntime })
      .click();
    await expect(drawing).toHaveCount(0);
    await expect(nodeBox(page, ARCHITECTURE_NODE.api)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(await where()).toEqual(before);

    // Escape does the same.
    await page.getByRole("button", { name: api.title, exact: true }).click();
    await expect(drawing).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawing).toHaveCount(0);
    await expect(nodeBox(page, ARCHITECTURE_NODE.api)).toBeFocused();
    expect(await where()).toEqual(before);
  });

  test("keyboard only: Tab to the job workers, press Enter, and their subsystems appear", async ({
    page,
  }) => {
    await signIn(page, USER_ROLE.agent);
    await page.goto(ROUTE.howItWorks.path);
    const workers = nodeBox(page, ARCHITECTURE_NODE.jobWorkers);
    await expect(workers).toBeVisible();

    // Start on the tab, and Tab forward until the job workers have focus.
    await page
      .getByRole("tab", { name: HOW_IT_WORKS_LABEL.architectureTab })
      .focus();
    for (let presses = 0; presses < ARCHITECTURE_NODES.length + 2; presses++) {
      await page.keyboard.press("Tab");
      if (await workers.evaluate((node) => node === document.activeElement))
        break;
    }
    await expect(workers).toBeFocused();
    await page.keyboard.press("Enter");

    const drawing = subsystemDrawing(page);
    for (const subsystem of subsystemsOf(ARCHITECTURE_NODE.jobWorkers)) {
      await expect(
        drawing.locator(`[${GRAPH_NODE_ATTRIBUTE}="${subsystem.id}"]`),
      ).toBeVisible();
    }
  });

  test("scrolling zooms the view while every box keeps its place across reloads", async ({
    page,
  }) => {
    await signIn(page, USER_ROLE.agent);
    await page.goto(ROUTE.howItWorks.path);
    await expect(nodeBox(page, ARCHITECTURE_NODE.api)).toBeVisible();

    const before = await boxPositions(page);
    await page.reload();
    await expect(nodeBox(page, ARCHITECTURE_NODE.api)).toBeVisible();
    expect(await boxPositions(page)).toEqual(before);

    const viewport = page.locator(`[${GRAPH_VIEWPORT_ATTRIBUTE}]`);
    // d3 writes nothing until the first gesture: the drawing starts unmoved.
    expect(await viewport.getAttribute("transform")).toBeNull();

    const canvas = page.getByRole("group", {
      name: HOW_IT_WORKS_LABEL.architectureCanvas,
    });
    const area = (await canvas.boundingBox())!;
    await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
    await page.mouse.wheel(0, -400);

    await expect(viewport).toHaveAttribute("transform", /scale\(/);

    // Dragging pans: the transform's translation moves with the pointer.
    const zoomed = await viewport.getAttribute("transform");
    await page.mouse.move(area.x + 40, area.y + 40);
    await page.mouse.down();
    await page.mouse.move(area.x + 140, area.y + 90, { steps: 5 });
    await page.mouse.up();
    await expect(viewport).not.toHaveAttribute("transform", zoomed!);
  });

  test("the lifecycle draws every step in its lane, tagged with its Status, with both forks and the three notes", async ({
    page,
  }) => {
    await signIn(page, USER_ROLE.agent);
    await page.goto(ROUTE.howItWorks.path);
    await openLifecycle(page);

    for (const step of LIFECYCLE_STEPS) {
      const box = nodeBox(page, step.id);
      await expect(box).toBeVisible();
      // A title is drawn wrapped, so compare the words, not the line breaks.
      expect(squash(await box.textContent())).toContain(squash(step.title));
      await expect(box.locator(`[${GRAPH_STATUS_TAG_ATTRIBUTE}]`)).toHaveText(
        step.status ?? NO_TICKET_YET,
      );

      const band = (await page
        .locator(`[${GRAPH_LANE_ATTRIBUTE}="${step.lane}"]`)
        .boundingBox())!;
      const rect = (await box.boundingBox())!;
      expect(rect.x, step.id).toBeGreaterThanOrEqual(band.x);
      expect(rect.y, step.id).toBeGreaterThanOrEqual(band.y);
      expect(rect.x + rect.width, step.id).toBeLessThanOrEqual(
        band.x + band.width,
      );
      expect(rect.y + rect.height, step.id).toBeLessThanOrEqual(
        band.y + band.height,
      );
    }

    const strip = page.locator(`[${GRAPH_STATUS_STRIP_ATTRIBUTE}]`);
    for (const status of Object.values(TICKET_STATUS)) {
      await expect(strip).toContainText(status);
    }

    // A fork: one step, an edge to each arm, and the two arms in one column.
    for (const { from, arms } of LIFECYCLE_BRANCHES) {
      const [a, b] = await Promise.all(
        arms.map((arm) => nodeBox(page, arm).boundingBox()),
      );
      expect(a!.x).toBe(b!.x);
      for (const arm of arms) {
        const edge = LIFECYCLE_EDGES.find(
          (e) => e.from === from && e.to === arm,
        )!;
        await expect(
          page.locator(`[${GRAPH_EDGE_ATTRIBUTE}="${edge.id}"]`),
        ).toBeAttached();
      }
    }

    for (const note of LIFECYCLE_NOTES) {
      const drawn = page.locator(`[${GRAPH_NOTE_ATTRIBUTE}="${note.id}"]`);
      await expect(drawn).toBeVisible();
      expect(squash(await drawn.textContent())).toBe(squash(note.text));
    }

    // Selecting a step explains it.
    const claim = lifecycleStep(LIFECYCLE_STEP.claim);
    await page.getByRole("button", { name: claim.title, exact: true }).click();
    const panel = page.getByRole("region", {
      name: HOW_IT_WORKS_LABEL.details,
    });
    await expect(panel).toContainText(claim.explanation);
  });

  test("Next, Previous, the arrow keys and a click walk the lifecycle in the data's order", async ({
    page,
  }) => {
    await signIn(page, USER_ROLE.agent);
    await page.goto(ROUTE.howItWorks.path);
    await openLifecycle(page);
    const before = await nodeGeometry(page);

    const next = page.getByRole("button", {
      name: HOW_IT_WORKS_LABEL.nextStep,
    });
    const previous = page.getByRole("button", {
      name: HOW_IT_WORKS_LABEL.previousStep,
    });
    const panel = page.getByRole("region", {
      name: HOW_IT_WORKS_LABEL.details,
    });

    await expect(previous).toBeDisabled();
    await next.click();
    await expectCurrent(page, LIFECYCLE_STEPS[0]!.id);
    await expect(previous).toBeDisabled();

    // Next N times is the data's Nth step.
    const n = 4;
    for (let pressed = 1; pressed < n; pressed++) await next.click();
    const nth = LIFECYCLE_STEPS[n - 1]!;
    await expectCurrent(page, nth.id);
    await expect(panel).toContainText(nth.title);
    await expect(previous).toBeEnabled();

    // ArrowLeft, with the canvas focused, goes back one.
    await page
      .getByRole("group", { name: HOW_IT_WORKS_LABEL.lifecycleCanvas })
      .focus();
    await page.keyboard.press("ArrowLeft");
    const back = LIFECYCLE_STEPS[n - 2]!;
    await expectCurrent(page, back.id);
    await expect(panel).toContainText(back.title);

    // Clicking a step jumps there; Close is the last, so Next stops.
    const close = lifecycleStep(LIFECYCLE_STEP.agentCloses);
    await page.getByRole("button", { name: close.title, exact: true }).click();
    await expectCurrent(page, close.id);
    await expect(panel).toContainText(close.title);
    await expect(next).toBeDisabled();

    // Only the view moved: every step is where the layout put it (R9).
    expect(await nodeGeometry(page)).toEqual(before);
  });

  test("under reduced motion, stepping to a step out of frame jumps the view there", async ({
    page,
  }) => {
    await signIn(page, USER_ROLE.agent);
    await page.goto(ROUTE.howItWorks.path);
    await openLifecycle(page);
    const before = await nodeGeometry(page);

    const { area, viewport, first, zoomed } = await zoomPastFirstStep(page);

    await page
      .getByRole("button", { name: HOW_IT_WORKS_LABEL.nextStep })
      .click();

    // A jump has landed by the time the press is handled; a glide would still
    // be on its way, and would end somewhere else.
    const landed = await viewport.getAttribute("transform");
    expect(landed).not.toBe(zoomed);
    // Not synchronisation: a fixed wait longer than any glide, to show that
    // nothing was still moving.
    await page.waitForTimeout(GRAPH_GLIDE_MS + 200);
    expect(await viewport.getAttribute("transform")).toBe(landed);
    expect(contains(area, (await first.boundingBox())!)).toBe(true);

    expect(await nodeGeometry(page)).toEqual(before);
  });

  test.describe("with motion allowed", () => {
    // The suite emulates reduced motion everywhere; this is the glide.
    test.use({ contextOptions: { reducedMotion: "no-preference" } });

    test("stepping to a step out of frame glides the view there", async ({
      page,
    }) => {
      await signIn(page, USER_ROLE.agent);
      await page.goto(ROUTE.howItWorks.path);
      await openLifecycle(page);
      const before = await nodeGeometry(page);
      const { area, viewport, first } = await zoomPastFirstStep(page);

      await page
        .getByRole("button", { name: HOW_IT_WORKS_LABEL.nextStep })
        .click();
      const started = await viewport.getAttribute("transform");

      await expect
        .poll(async () => contains(area, (await first.boundingBox())!))
        .toBe(true);
      // As above: a fixed wait past the glide's end, so the view has settled.
      await page.waitForTimeout(GRAPH_GLIDE_MS + 200);
      // Still on its way when the press had been handled, unlike a jump.
      expect(started).not.toBe(await viewport.getAttribute("transform"));

      expect(await nodeGeometry(page)).toEqual(before);
    });
  });

  /**
   * Signs in as `role`, selects Classification on the lifecycle, checks its
   * repo paths are listed, and returns the panel's "On screen" line, which
   * must name the Pipeline page.
   */
  async function classificationScreen(page: Page, role: UserRole) {
    await signIn(page, role);
    await page.goto(ROUTE.howItWorks.path);
    await openLifecycle(page);

    const classification = lifecycleStep(LIFECYCLE_STEP.classification);
    await page
      .getByRole("button", { name: classification.title, exact: true })
      .click();
    const panel = page.getByRole("region", {
      name: HOW_IT_WORKS_LABEL.details,
    });
    await expect(panel.locator(`[${GRAPH_CODE_ATTRIBUTE}] li`)).toHaveText([
      ...classification.code,
    ]);
    const screen = panel.locator(`[${GRAPH_SCREEN_ATTRIBUTE}]`);
    await expect(screen).toHaveAttribute(
      GRAPH_SCREEN_ATTRIBUTE,
      ROUTE.pipeline.path,
    );
    // The screen's name follows the prefix, link or not.
    await expect(screen).toHaveText(
      new RegExp(`^${HOW_IT_WORKS_LABEL.screen}:\\s*\\S`),
    );
    return screen;
  }

  test("an admin follows Classification's screen link to the Pipeline page, past its repo paths", async ({
    page,
  }) => {
    const screen = await classificationScreen(page, USER_ROLE.admin);
    await screen.getByRole("link").click();
    await page.waitForURL(ROUTE.pipeline.path);
  });

  test("an agent sees Classification's screen named, with no link to a page they cannot open", async ({
    page,
  }) => {
    const screen = await classificationScreen(page, USER_ROLE.agent);
    await expect(screen.getByRole("link")).toHaveCount(0);
  });
  test.describe("on a phone", () => {
    test.use({ viewport: PHONE });

    test("the panel sits below the canvas, nothing scrolls sideways, and the zoom buttons work from the keyboard", async ({
      page,
    }) => {
      await signIn(page, USER_ROLE.agent);
      await page.goto(ROUTE.howItWorks.path);

      for (const [canvasName, open] of [
        [HOW_IT_WORKS_LABEL.architectureCanvas, async () => {}],
        [HOW_IT_WORKS_LABEL.lifecycleCanvas, () => openLifecycle(page)],
      ] as const) {
        await open();
        const canvas = await boxOf(
          page.getByRole("group", { name: canvasName }),
        );
        const panel = await boxOf(details(page));
        expect(panel.y, canvasName).toBeGreaterThanOrEqual(
          canvas.y + canvas.height,
        );
        // The canvas fills the page's width, inside its padding.
        expect(canvas.width, canvasName).toBeGreaterThan(PHONE.width * 0.75);
        expect(await sidewaysScroll(page), canvasName).toEqual({
          window: false,
          page: false,
        });
      }

      // On the lifecycle, now open: walk, zoom by keyboard, then reset.
      const canvas = page.getByRole("group", {
        name: HOW_IT_WORKS_LABEL.lifecycleCanvas,
      });
      const viewport = canvas.locator(`[${GRAPH_VIEWPORT_ATTRIBUTE}]`);
      const next = page.getByRole("button", {
        name: HOW_IT_WORKS_LABEL.nextStep,
      });
      for (let n = 0; n < 3; n++) await next.click();
      await expectCurrent(page, LIFECYCLE_STEPS[2]!.id);

      const zoomIn = page.getByRole("button", {
        name: HOW_IT_WORKS_LABEL.zoomIn,
      });
      await zoomIn.focus();
      await page.keyboard.press("Enter");
      await expect(viewport).toHaveAttribute("transform", /scale\(1\.5\)$/);
      await page.keyboard.press("Enter");
      await expect(viewport).toHaveAttribute("transform", /scale\(2\.25\)$/);
      // Tab to zoom out, and Space presses it.
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("button", { name: HOW_IT_WORKS_LABEL.zoomOut }),
      ).toBeFocused();
      await page.keyboard.press("Space");
      await expect(viewport).toHaveAttribute("transform", /scale\(1\.5\)$/);

      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("button", { name: HOW_IT_WORKS_LABEL.resetView }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(viewport).toHaveAttribute(
        "transform",
        "translate(0,0) scale(1)",
      );

      // The whole picture is back, and the walk starts over.
      await expect(page.locator(`[${GRAPH_EMPHASIS_ATTRIBUTE}]`)).toHaveCount(
        0,
      );
      for (const step of LIFECYCLE_STEPS) {
        await expect(nodeBox(page, step.id), step.id).toHaveAttribute(
          "aria-pressed",
          "false",
        );
      }
      await expect(details(page).getByRole("heading")).toHaveCount(0);
      await next.click();
      await expectCurrent(page, LIFECYCLE_STEPS[0]!.id);
    });
  });

  for (const viewport of [DESKTOP, PHONE]) {
    test.describe(`at ${viewport.width}x${viewport.height}`, () => {
      test.use({ viewport });

      test("the page is inset like the Dashboard, and nothing is clipped", async ({
        page,
      }) => {
        await signIn(page, USER_ROLE.agent);
        await page.goto(ROUTE.dashboard.path);
        const dashboard = await insetFromContent(
          page,
          page.getByRole("heading", { level: 1 }),
        );
        // The Dashboard's padding, which every page shares.
        expect(dashboard.left).toBeGreaterThan(0);

        await page.goto(ROUTE.howItWorks.path);
        const parts = {
          header: page.getByRole("heading", { level: 1, name: "How it works" }),
          tabs: page.getByRole("tablist"),
          canvas: page.getByRole("group", {
            name: HOW_IT_WORKS_LABEL.architectureCanvas,
          }),
          panel: details(page),
          zoom: page.getByRole("group", {
            name: HOW_IT_WORKS_LABEL.zoomControls,
            exact: true,
          }),
        };
        // What spans the page sits exactly the padding in from both edges
        // (the canvas one pixel more, inside its frame's border); the tabs
        // and the zoom buttons sit at least that far in.
        const padded = {
          header: { left: dashboard.left },
          canvas: { left: dashboard.left + 1, right: dashboard.left + 1 },
          panel: { left: dashboard.left, right: dashboard.left },
        } as Record<string, { left?: number; right?: number }>;
        for (const [name, part] of Object.entries(parts)) {
          const inset = await insetFromContent(page, part);
          for (const side of ["left", "right"] as const) {
            const exact = padded[name]?.[side];
            if (exact === undefined) {
              expect(inset[side], `${name} ${side}`).toBeGreaterThanOrEqual(
                dashboard.left - SLACK,
              );
            } else {
              expect(
                Math.abs(inset[side] - exact),
                `${name} ${side}`,
              ).toBeLessThanOrEqual(SLACK);
            }
          }
          // Wholly inside the window, and not cut off by the frame around it.
          const box = await boxOf(part);
          expect(box.x, name).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width, name).toBeLessThanOrEqual(viewport.width);
          expect(await clipped(part), name).toBe(false);
        }
        expect(await sidewaysScroll(page)).toEqual({
          window: false,
          page: false,
        });
      });
    });
  }

  test("every lifecycle step keeps its place across tab switches and reloads", async ({
    page,
  }) => {
    await signIn(page, USER_ROLE.agent);
    await page.goto(ROUTE.howItWorks.path);
    await openLifecycle(page);
    const before = await stepPositions(page);

    await page
      .getByRole("tab", { name: HOW_IT_WORKS_LABEL.architectureTab })
      .click();
    await expect(nodeBox(page, ARCHITECTURE_NODE.api)).toBeVisible();
    await openLifecycle(page);
    expect(await stepPositions(page)).toEqual(before);

    await page.reload();
    await openLifecycle(page);
    expect(await stepPositions(page)).toEqual(before);
  });
});
