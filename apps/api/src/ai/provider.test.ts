/**
 * What the SDK reports about a call, and what this app records about it.
 *
 * This file exists because of a bug that cost nothing and hid everything. The
 * `AiUsage` interface below was hand-written against the AI SDK's *v5* usage
 * shape — flat `cachedInputTokens` and `reasoningTokens` — while the installed
 * SDK is v7, which reports those two under `inputTokenDetails.cacheReadTokens`
 * and `outputTokenDetails.reasoningTokens`. Assigning one to the other
 * typechecked, because every field on `AiUsage` was optional and an absent
 * optional field is a legal value. So both counts read `undefined`, `logUsage`
 * printed `cached=0 reasoning=0`, and had done since the first AI feature
 * shipped.
 *
 * `cached=0` is the exact signal `ai-features.md` names as the regression to
 * watch for, so the field that was supposed to be an alarm was a stuck needle.
 * The eval harness is what surfaced it: two full runs, 350 calls, every one of
 * them `cached=0`.
 *
 * Hence the shape of the fix, and of this file. `toAiUsage` is a named seam
 * that takes the SDK's type by name — so the next SDK bump that moves a field
 * fails to compile here rather than silently reading zero — and `AiUsage`'s
 * fields are required (`number | undefined`, not `?:`) so a mapper that forgets
 * one cannot typecheck either.
 */

import { describe, expect, spyOn, test } from "bun:test";
import type { LanguageModelUsage } from "ai";
import type { AiUsage } from "./provider";

/**
 * Set before `./provider` is imported below, and the import is dynamic for that
 * reason rather than for the mock-registration one `testing.md` gives.
 *
 * `provider.ts` reads `OPENAI_API_KEY` into a module-level `const` at import,
 * and bun evaluates a module once for the whole process — so whichever test file
 * pulls it in first decides what `isAiConfigured()` answers for every file after
 * it. Nothing here needs a key; a *static* import from this file still linked
 * `./provider` during the load phase, ahead of `polish.test.ts` setting its own,
 * and left `isPolishConfigured()` false in a file that never mentions this one.
 * It passed on Windows and failed on `ubuntu-latest`, which is the file-order
 * difference `testing.md` warns about wearing different clothes: the hazard is
 * not only `mock.module`, it is anything a module captures at import.
 */
process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";

const { logUsage, toAiUsage, usdFor } = await import("./provider");

/** What `@ai-sdk/openai` v4 actually hands back, via `convertOpenAIChatUsage`. */
function sdkUsage(over: Partial<LanguageModelUsage> = {}): LanguageModelUsage {
  return {
    inputTokens: 4_000,
    inputTokenDetails: {
      noCacheTokens: 1_000,
      cacheReadTokens: 3_000,
      cacheWriteTokens: 0,
    },
    outputTokens: 500,
    outputTokenDetails: { textTokens: 380, reasoningTokens: 120 },
    totalTokens: 4_500,
    ...over,
  };
}

/** The mapping under test, for the reported-usage case every test but one is about. */
function mapped(over: Partial<LanguageModelUsage> = {}): AiUsage {
  const usage = toAiUsage(sdkUsage(over));
  if (!usage) throw new Error("a reported call mapped to no usage");
  return usage;
}

describe("toAiUsage", () => {
  test("reads the cached count out of the nested details the SDK reports", () => {
    expect(mapped().cachedInputTokens).toBe(3_000);
  });

  test("reads the reasoning count out of the nested details too", () => {
    expect(mapped().reasoningTokens).toBe(120);
  });

  test("carries the three flat counts across unchanged", () => {
    const usage = mapped();

    expect(usage.inputTokens).toBe(4_000);
    expect(usage.outputTokens).toBe(500);
    expect(usage.totalTokens).toBe(4_500);
  });

  test("is undefined for a call that reported nothing", () => {
    expect(toAiUsage(undefined)).toBeUndefined();
  });

  test("keeps an unreported field undefined rather than reading it as zero", () => {
    // The distinction `usdFor`'s doc comment relies on: nothing known to charge
    // is not the same claim as a measured zero.
    const usage = mapped({
      inputTokenDetails: {
        noCacheTokens: undefined,
        cacheReadTokens: undefined,
        cacheWriteTokens: undefined,
      },
    });

    expect(usage.cachedInputTokens).toBeUndefined();
  });
});

describe("usdFor", () => {
  test("prices a cached token at a tenth of a fresh one", () => {
    const fresh = usdFor({
      inputTokens: 4_000,
      cachedInputTokens: 0,
      outputTokens: 0,
      totalTokens: 4_000,
      reasoningTokens: 0,
    });
    const cached = usdFor({
      inputTokens: 4_000,
      cachedInputTokens: 4_000,
      outputTokens: 0,
      totalTokens: 4_000,
      reasoningTokens: 0,
    });

    expect(cached).toBeCloseTo(fresh / 10, 12);
  });

  test("prices the SDK's own shape, end to end", () => {
    // 1_000 fresh + 3_000 cached + 500 output, at the published nano rates.
    const expected = (1_000 * 0.05 + 3_000 * 0.005 + 500 * 0.4) / 1_000_000;

    expect(usdFor(mapped())).toBeCloseTo(expected, 12);
  });
});

describe("logUsage", () => {
  test("prints the cached and reasoning counts the SDK reported", () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      logUsage("auto-reply", "gpt-5-nano", mapped());

      const line = String(log.mock.calls[0]?.[0]);
      expect(line).toContain("cached=3000");
      expect(line).toContain("reasoning=120");
    } finally {
      log.mockRestore();
    }
  });
});
