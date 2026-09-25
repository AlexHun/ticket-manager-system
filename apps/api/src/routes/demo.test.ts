/**
 * Unit tests for `./demo` — the public presence boolean the login page reads
 * to decide whether to offer "Use demo session" (#319).
 *
 * No guard to stub: the route is public on purpose, because nobody asking it
 * has signed in yet. The switch is read per request from `../demo/mode`, a
 * leaf nothing mocks, so flipping `process.env` here is the whole setup.
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { DemoStatusResponse } from "@ticket/shared";
import { serveRouter } from "../test/route-app";

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
