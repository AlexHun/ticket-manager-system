/**
 * Unit tests for `./demo-usage` — the admin's weekly demo figures on the wire
 * (#327, PRD R14). The counting itself is `../demo/usage.test.ts`'s; this is
 * the shape the Users page reads.
 *
 * The guard is the real `requireAdmin` (#366), so the request asks as the
 * seeded admin.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import type { DemoUsageResponse } from "@ticket/shared";
import { refusesAgentAndDemo } from "../test/boundary";
import { asCaller } from "../test/caller";
import { seedColleagues } from "../test/fixtures";
import { resetDb } from "../test/pg";
import { serveRouter } from "../test/route-app";

const { markDemoTicketOpened, recordDemoStart } = await import("../demo/usage");
const { demoUsageRouter } = await import("./demo-usage");

const url = serveRouter("/api/demo/usage", demoUsageRouter);

beforeEach(async () => {
  await resetDb();
  await seedColleagues("admin");
});

/* ── Who it refuses (#367) ───────────────────────────────────────────────── */

refusesAgentAndDemo(url, demoUsageRouter, ["GET /"]);

describe("GET /api/demo/usage", () => {
  test("answers this week's two figures and the Monday they count from", async () => {
    await recordDemoStart("visitor-a", new Date());
    await recordDemoStart("visitor-b", new Date());
    await markDemoTicketOpened("visitor-b");

    const res = await fetch(url("/"), { headers: asCaller("admin") });
    const body = (await res.json()) as DemoUsageResponse;

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      sessionsStarted: 2,
      sessionsOpenedTicket: 1,
    });
    const monday = new Date(body.weekStartsAt);
    expect(monday.getUTCDay()).toBe(1);
    expect(monday.toISOString().endsWith("T00:00:00.000Z")).toBe(true);
    expect(monday.getTime()).toBeLessThanOrEqual(Date.now());
  });
});
