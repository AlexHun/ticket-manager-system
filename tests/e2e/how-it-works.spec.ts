import { test, expect, type Page } from "@playwright/test";
import { NEW_FEATURE_KEY, USER_ROLE } from "@ticket/shared";
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
  GRAPH_EDGE_ATTRIBUTE,
  GRAPH_NODE_ATTRIBUTE,
  GRAPH_VIEWPORT_ATTRIBUTE,
  HOW_IT_WORKS_LABEL,
  LIFECYCLE_COMING_NEXT,
} from "../../apps/web/src/lib/how-it-works/dom";
import { ROUTE } from "../../apps/web/src/lib/routes";

/**
 * Slice 1 of `docs/plans/how-it-works.md` (#455): the nav item, the Architecture
 * view's runtime boxes on a zoomable canvas, and the panel. Every test runs
 * against an empty ticket table, because the page reads no ticket data (R12).
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

async function boxPositions(page: Page) {
  const positions: Record<string, unknown> = {};
  for (const node of ARCHITECTURE_NODES) {
    positions[node.id] = await nodeBox(page, node.id).boundingBox();
  }
  return positions;
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

    // The other tab, until slice 2 draws it.
    await page
      .getByRole("tab", { name: HOW_IT_WORKS_LABEL.lifecycleTab })
      .click();
    await expect(page.getByText(LIFECYCLE_COMING_NEXT)).toBeVisible();

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
});
