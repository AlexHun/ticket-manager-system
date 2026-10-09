/**
 * Unit tests for `./demo` — the public presence boolean the login page reads
 * to decide whether to offer "Use demo session" (#319), and the welcome-step
 * mark a demo session's click sends (#464).
 *
 * The boolean has no guard and no caller: it is public on purpose, because
 * nobody asking it has signed in yet. The switch is read per request from
 * `../demo/mode`, a leaf nothing mocks, so flipping `process.env` here is the
 * whole setup. The mark runs the real `requireAuth` (#366), so its tests seed
 * whoever they ask as.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { DemoStatusResponse } from "@ticket/shared";
import { asCaller } from "../test/caller";
import { seedColleagues } from "../test/fixtures";
import { resetDb } from "../test/pg";
import { serveRouter } from "../test/route-app";

const { demoUsageThisWeek, recordDemoStart } = await import("../demo/usage");
const { demoRouter } = await import("./demo");

const url = serveRouter("/api/demo", demoRouter);

async function status(): Promise<DemoStatusResponse> {
  const res = await fetch(url("/"));
  expect(res.status).toBe(200);
  return (await res.json()) as DemoStatusResponse;
}

afterEach(() => {
  delete process.env.DEMO_MODE_ENABLED;
});

describe("GET /api/demo", () => {
  test('reports demo mode on only for the literal "true"', async () => {
    process.env.DEMO_MODE_ENABLED = "true";

    expect(await status()).toEqual({ enabled: true });
  });

  // The same list `routes/users.test.ts` asks the sign-in refusal about.
  test.each([undefined, "false", "1", "TRUE", "yes"])(
    "reports it off for %p",
    async (value) => {
      if (value === undefined) delete process.env.DEMO_MODE_ENABLED;
      else process.env.DEMO_MODE_ENABLED = value;

      expect(await status()).toEqual({ enabled: false });
    },
  );

  // Read per request, like the refusal in `../auth`, so the button and the
  // endpoint behind it can never disagree about whether demo mode is on.
  test("follows the switch between requests", async () => {
    process.env.DEMO_MODE_ENABLED = "true";
    expect((await status()).enabled).toBe(true);

    delete process.env.DEMO_MODE_ENABLED;
    expect((await status()).enabled).toBe(false);
  });
});

describe("POST /api/demo/welcome-step", () => {
  const followStep = (headers: Record<string, string>) =>
    fetch(url("/welcome-step"), { method: "POST", headers });

  beforeEach(async () => {
    await resetDb();
    await seedColleagues("admin", "agent", "demoVisitor");
    await recordDemoStart("u_demo", new Date(Date.now() - 60 * 60 * 1000));
  });

  test("marks the demo session as having followed a step", async () => {
    const res = await followStep(asCaller("demoVisitor"));

    expect(res.status).toBe(204);
    expect((await demoUsageThisWeek()).sessionsFollowedStep).toBe(1);
  });

  // R11 counts sessions that followed *at least one* step.
  test("a second step, or the same one again, changes nothing", async () => {
    for (let i = 0; i < 3; i += 1) {
      expect((await followStep(asCaller("demoVisitor"))).status).toBe(204);
    }

    expect(await demoUsageThisWeek()).toMatchObject({
      sessionsStarted: 1,
      sessionsFollowedStep: 1,
    });
  });

  // Only a demo session has a welcome. An admin's or an agent's click would
  // be a figure about somebody who is not a visitor.
  async function expectRefused(headers: Record<string, string>) {
    const res = await followStep(headers);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
    expect((await demoUsageThisWeek()).sessionsFollowedStep).toBe(0);
  }

  test("refuses an admin's session", () => expectRefused(asCaller("admin")));

  test("refuses an agent's session", () => expectRefused(asCaller("agent")));

  test("refuses a request with no session", async () => {
    const res = await followStep(asCaller("nobody"));

    expect(res.status).toBe(401);
    expect((await demoUsageThisWeek()).sessionsFollowedStep).toBe(0);
  });
});
