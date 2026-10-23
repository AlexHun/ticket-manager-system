/**
 * The scripted model's own promises (#578): what every test that scripts an
 * answer relies on without checking. `ai/polish.test.ts` is where the fake is
 * used; this is where it is held to its header.
 */

import { describe, expect, test } from "bun:test";
import { generateText, Output } from "ai";
import { z } from "zod";
import {
  modelCalls,
  providerError,
  resetModel,
  scriptModel,
  scriptedFeature,
  unscripted,
} from "./model";

// Through the preload's registration, so this is the function every feature
// calls, and the fake is what it hands back.
const { openaiModel } = await import("../ai/provider");

function ask(feature: "polish" | "classify", prompt = "hello") {
  return generateText({
    model: openaiModel(feature, "gpt-5-nano"),
    system: `the ${feature} prompt`,
    prompt,
    maxRetries: 1,
    providerOptions: { openai: { reasoningEffort: "low" } },
  });
}

describe("an answer", () => {
  test("is scripted per feature, whatever order the calls come in", async () => {
    scriptModel("polish", { text: "polished" });
    scriptModel("classify", { text: "classified" });

    expect((await ask("classify")).text).toBe("classified");
    expect((await ask("polish")).text).toBe("polished");
  });

  test("is consumed in order, and the last one repeats", async () => {
    scriptModel("polish", { text: "first" }, { text: "then this" });

    expect((await ask("polish")).text).toBe("first");
    expect((await ask("polish")).text).toBe("then this");
    expect((await ask("polish")).text).toBe("then this");
  });

  test("carries a structured answer through the real Output.object", async () => {
    scriptModel("classify", { text: '{"category":"Billing"}' });

    const { output } = await generateText({
      model: openaiModel("classify", "gpt-5-nano"),
      prompt: "my invoice",
      output: Output.object({ schema: z.object({ category: z.string() }) }),
    });

    expect(output).toEqual({ category: "Billing" });
    expect(modelCalls("classify")[0]?.responseFormat?.type).toBe("json");
  });

  test("can be a provider failure, which the real retry asks again about", async () => {
    scriptModel(
      "polish",
      { throws: providerError(503) },
      { text: "recovered" },
    );

    expect((await ask("polish")).text).toBe("recovered");
    expect(modelCalls("polish")).toHaveLength(2);
  });
});

describe("a call", () => {
  test("is recorded with what it was sent", async () => {
    scriptModel("polish", { text: "ok" });

    await ask("polish", "the draft");

    expect(modelCalls()).toEqual([
      expect.objectContaining({
        feature: "polish",
        modelId: "gpt-5-nano",
        system: "the polish prompt",
        prompt: "the draft",
        providerOptions: { openai: { reasoningEffort: "low" } },
      }),
    ]);
    expect(scriptedFeature(openaiModel("polish", "gpt-5-nano"))).toBe("polish");
  });

  test("with nothing scripted fails, naming the feature and the model id", async () => {
    const failed = await ask("classify").catch((err: unknown) => err);

    expect(String(failed)).toContain('"classify" (gpt-5-nano)');
    // The preload's `afterEach` fails a test that leaves one of these behind,
    // which is the loud half for a feature that swallows the throw. Cleared
    // here because this test made it on purpose.
    expect(unscripted).toHaveLength(1);
    resetModel();
  });
});

describe("between tests", () => {
  test("a test scripts an answer", () => {
    scriptModel("polish", { text: "left behind" });
  });

  test("and the next one inherits neither it nor the calls", async () => {
    expect(modelCalls()).toEqual([]);
    const failed = await ask("polish").catch((err: unknown) => err);

    expect(String(failed)).toContain("No model answer scripted");
    resetModel();
  });
});
