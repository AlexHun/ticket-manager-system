import { test, expect, type Page } from "@playwright/test";
import { NEW_FEATURE_KEY, TICKET_STATUS, USER_ROLE } from "@ticket/shared";
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
 * `docs/plans/how-it-works.md`, slices 1 to 5 (#455, #456, #457, #458, #459):
 * the nav item, the Architecture view's runtime boxes on a zoomable canvas and
 * the subsystems they open onto, the Ticket lifecycle in its swimlanes,
 * walking it step by step, and the panel with its way into the code. Every
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

  test("an admin follows Classification's screen link to the Pipeline page, past its repo paths", async ({
    page,
  }) => {
    await signIn(page, USER_ROLE.admin);
    await page.goto(ROUTE.howItWorks.path);
    await openLifecycle(page);

    const classification = lifecycleStep(LIFECYCLE_STEP.classification);
    await page
      .getByRole("button", { name: classification.title, exact: true })
      .click();
    const panel = page.getByRole("region", {
      name: HOW_IT_WORKS_LABEL.details,
    });
    const paths = panel.locator(`[${GRAPH_CODE_ATTRIBUTE}] li`);
    await expect(paths).toHaveText([...classification.code]);

    const screen = panel.locator(`[${GRAPH_SCREEN_ATTRIBUTE}]`);
    await expect(screen).toHaveAttribute(
      GRAPH_SCREEN_ATTRIBUTE,
      ROUTE.pipeline.path,
    );
    await screen.getByRole("link").click();
    await page.waitForURL(ROUTE.pipeline.path);
  });

  test("an agent sees Classification's screen named, with no link to a page they cannot open", async ({
    page,
  }) => {
    await signIn(page, USER_ROLE.agent);
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
    await expect(screen.getByRole("link")).toHaveCount(0);
  });

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
