import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "../test/pg";
import {
  chargeDemoAi,
  demoAiLimitReached,
  secondsUntilDemoAiReset,
} from "./ai-budget";

/**
 * The demo sessions' shared daily AI budget (#321, PRD R8), over the real
 * in-process Postgres: what is asserted is the total a day ends up holding,
 * which is a fact about the row and not about the calls that wrote it.
 */

const NOON = new Date("2026-09-26T12:00:00.000Z");
const LAST_SECOND = new Date("2026-09-26T23:59:59.999Z");
const MIDNIGHT = new Date("2026-09-27T00:00:00.000Z");

beforeEach(async () => {
  await resetDb();
  delete process.env.DEMO_AI_DAILY_USD;
});

afterEach(() => {
  delete process.env.DEMO_AI_DAILY_USD;
});

describe("the daily total", () => {
  test("a day nothing was spent on is under the limit", async () => {
    expect(await demoAiLimitReached(NOON)).toBe(false);
  });

  test("defaults to $1.00: 0.99 is under, and reaching 1.00 is the limit", async () => {
    await chargeDemoAi(0.99, NOON);
    expect(await demoAiLimitReached(NOON)).toBe(false);

    await chargeDemoAi(0.01, NOON);
    expect(await demoAiLimitReached(NOON)).toBe(true);
  });

  // Quarters, because they are exact in binary: ten 0.1s sum to 0.999…9 in a
  // double, which would read as a lost update that never happened.
  test("charges add up, including ones that land together", async () => {
    process.env.DEMO_AI_DAILY_USD = "2.5";
    await Promise.all(
      Array.from({ length: 10 }, () => chargeDemoAi(0.25, NOON)),
    );

    expect(await demoAiLimitReached(NOON)).toBe(true);
  });

  test("rolls over at 00:00 UTC", async () => {
    await chargeDemoAi(5, NOON);

    expect(await demoAiLimitReached(LAST_SECOND)).toBe(true);
    expect(await demoAiLimitReached(MIDNIGHT)).toBe(false);
  });

  test("a call that reported no usage charges nothing", async () => {
    process.env.DEMO_AI_DAILY_USD = "0.000001";
    await chargeDemoAi(0, NOON);

    expect(await demoAiLimitReached(NOON)).toBe(false);
  });
});

describe("DEMO_AI_DAILY_USD", () => {
  test("sets the limit, so a test can make it tiny", async () => {
    process.env.DEMO_AI_DAILY_USD = "0.000001";
    await chargeDemoAi(0.000001, NOON);

    expect(await demoAiLimitReached(NOON)).toBe(true);
  });

  test("zero switches demo AI off for the day before anything is spent", async () => {
    process.env.DEMO_AI_DAILY_USD = "0";

    expect(await demoAiLimitReached(NOON)).toBe(true);
  });

  // A typo must not lift the cap. $1.00 is what the PRD promises the owner.
  test.each(["", "one dollar", "-5", "Infinity"])(
    "%p falls back to $1.00",
    async (value) => {
      process.env.DEMO_AI_DAILY_USD = value;
      await chargeDemoAi(0.99, NOON);
      expect(await demoAiLimitReached(NOON)).toBe(false);

      await chargeDemoAi(0.01, NOON);
      expect(await demoAiLimitReached(NOON)).toBe(true);
    },
  );
});

describe("secondsUntilDemoAiReset", () => {
  test("counts to the next 00:00 UTC", () => {
    expect(secondsUntilDemoAiReset(NOON)).toBe(12 * 60 * 60);
    expect(secondsUntilDemoAiReset(LAST_SECOND)).toBe(1);
  });

  test("a whole day at midnight itself, never zero", () => {
    expect(secondsUntilDemoAiReset(MIDNIGHT)).toBe(24 * 60 * 60);
  });
});
