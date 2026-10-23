/**
 * The model every API test talks to (#578): one fake, registered once in the
 * preload, scripted per test.
 *
 * Every AI feature gets its model from `openaiModel` in `../ai/provider`, and
 * the preload replaces that one function with `scriptedModel` below. Nothing
 * else is replaced. `generateText`, `Output.object` parsing, the usage mapping
 * and the SDK's retries all run for real, so a test that scripts an answer
 * exercises everything between the feature and the wire. Before this, each test
 * that needed an answer registered a `mock.module` stand-in of its own, at a
 * different depth each time, and the registry hazard in `testing-api.md` made
 * every one of them a one-function shim (`docs/prd/scripted-model.md`).
 *
 * ## How a test uses it
 *
 *     scriptModel("polish", { text: "Hi Marta, …" });
 *     await polishDraft(…);
 *     expect(modelCalls("polish")[0].prompt).toContain("TR-99182");
 *
 * - **Answers are scripted per feature**, not per model id: all four features
 *   run on `gpt-5-nano`, so the id cannot tell their calls apart, and
 *   `openaiModel` takes the feature for exactly this. A flow that classifies
 *   and then replies gets each feature's answer whatever order the calls land
 *   in.
 * - **Answers are consumed in order and the last one repeats.** One answer is
 *   every call's answer; `(fail, fail, ok)` is a retry ladder.
 * - **Everything is reset before every test**, by the preload's `beforeEach`.
 *   A test that forgot to script cannot inherit the previous test's answer.
 * - **An unscripted call throws, naming the feature and the model id.** Every
 *   feature catches its own provider errors and turns them into a result, so
 *   that throw alone would read as an ordinary `provider` failure; the call is
 *   recorded in `unscripted` too, and the preload's `afterEach` fails the test
 *   that made it.
 *
 * ## Retries, and why `providerError` carries `retry-after-ms: 0`
 *
 * The SDK retries a retryable `APICallError` (408, 409, 429, 5xx) with a real
 * exponential backoff: measured under #578, one 429 at `maxRetries: 1` cost
 * 2029ms, the SDK's 2000ms initial delay. The same error carrying
 * `retry-after-ms: 0` — a header OpenAI really sends, which the SDK reads
 * before its own backoff — cost 16ms. `providerError` sets it, so a test of a
 * retried failure still makes every attempt and pays nothing to wait. A test
 * that wants the real backoff can build its own `APICallError`.
 *
 * ## `maxRetries` and `timeout`
 *
 * They are `generateText` options the model never receives, so they are
 * proven by behaviour: a scripted retryable failure is asked again exactly as
 * many times as `maxRetries` allows (count `modelCalls`), and `{ hangs: true }`
 * answers only when the call's abort signal fires — which a timeout is. See
 * `ai/polish.test.ts` for both.
 */

import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
// Types only, so nothing here links `../ai/provider`, which reads its key at
// import: the preload sets that key after its own imports are evaluated.
import type { AiFeature, openaiModel } from "../ai/provider";

type CallOptions = Parameters<MockLanguageModelV4["doGenerate"]>[0];
type GenerateResult = Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;

/** Token counts in the provider's own (`LanguageModelV4`) shape. */
export type ModelUsage = GenerateResult["usage"];

/** One scripted answer. */
export type ModelAnswer =
  /** The model answers this text. A structured answer is its JSON. */
  | { text: string; usage?: ModelUsage }
  /** The provider call throws this. See `providerError`. */
  | { throws: unknown }
  /** No answer until the call is aborted — a slow model, cut off. */
  | { hangs: true };

/** What one call was sent, flattened from the SDK's prompt. */
export interface ModelCall {
  feature: AiFeature;
  modelId: string;
  /** The system prompt, or `""` when the call had none. */
  system: string;
  /** The user prompt's text. */
  prompt: string;
  providerOptions: CallOptions["providerOptions"];
  maxOutputTokens: CallOptions["maxOutputTokens"];
  /** `{ type: "json", schema }` for an `Output.object` call. */
  responseFormat: CallOptions["responseFormat"];
  /** The signal the SDK handed the model: the caller's, merged with the timeout. */
  abortSignal: CallOptions["abortSignal"];
}

/** A usage report with nothing in it, for an answer that names none. */
const NO_USAGE: ModelUsage = {
  inputTokens: {
    total: undefined,
    noCache: undefined,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
};

const scripts = new Map<AiFeature, ModelAnswer[]>();
const calls: ModelCall[] = [];

/** Calls that arrived with nothing scripted, as the error each one threw. */
export const unscripted: Error[] = [];

/** Script what `feature`'s calls answer: in order, the last one repeating. */
export function scriptModel(
  feature: AiFeature,
  first: ModelAnswer,
  ...rest: ModelAnswer[]
): void {
  scripts.set(feature, [first, ...rest]);
}

/** Every call made since the last reset, oldest first, or only `feature`'s. */
export function modelCalls(feature?: AiFeature): ModelCall[] {
  return feature
    ? calls.filter((call) => call.feature === feature)
    : [...calls];
}

/** What `feature`'s most recent call was sent. Throws when it made none. */
export function lastModelCall(feature: AiFeature): ModelCall {
  const call = modelCalls(feature).at(-1);
  if (!call) throw new Error(`the model was never asked to ${feature}`);
  return call;
}

/** Forget every script and every call. The preload runs it before each test. */
export function resetModel(): void {
  scripts.clear();
  calls.length = 0;
  unscripted.length = 0;
}

/**
 * A provider failure as the SDK raises it: retryable when the status is, with
 * the response body `classify` reads, and a zero retry delay (see the header).
 */
export function providerError(statusCode: number, body = ""): APICallError {
  return new APICallError({
    message: "the provider said no",
    url: "https://api.openai.com/v1/responses",
    requestBodyValues: {},
    statusCode,
    responseHeaders: { "retry-after-ms": "0" },
    responseBody: body,
  });
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part: { type?: string; text?: string }) =>
      part.type === "text" ? (part.text ?? "") : "",
    )
    .join("");
}

function recorded(
  feature: AiFeature,
  modelId: string,
  options: CallOptions,
): ModelCall {
  const messages = options.prompt;
  return {
    feature,
    modelId,
    system: messages
      .filter((message) => message.role === "system")
      .map((message) => textOf(message.content))
      .join("\n"),
    prompt: messages
      .filter((message) => message.role === "user")
      .map((message) => textOf(message.content))
      .join("\n"),
    providerOptions: options.providerOptions,
    maxOutputTokens: options.maxOutputTokens,
    responseFormat: options.responseFormat,
    abortSignal: options.abortSignal,
  };
}

function hang(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason as Error), {
      once: true,
    });
  });
}

/**
 * What `isAiConfigured` answers, or `undefined` for whatever the real one does.
 *
 * The preload's registration of `../ai/provider` carries this switch beside the
 * fake model, and its `beforeEach` puts it back to `undefined`. It lived in
 * `jobs/sweeps.test.ts` until #578, which registered the same specifier for it.
 */
export const aiSwitch: { configured: boolean | undefined } = {
  configured: undefined,
};

let realOpenaiModel: typeof openaiModel | undefined;

/**
 * The preload hands over the real `openaiModel` before it replaces it. Handed
 * over rather than imported, because this module must not link the provider
 * (see the import above).
 */
export function rememberRealOpenaiModel(real: typeof openaiModel): void {
  realOpenaiModel = real;
}

/**
 * The real `openaiModel`, for `ai/provider.test.ts`: importing `./provider`
 * from a test file gets the preload's registration, whose `openaiModel` is the
 * fake.
 */
export function realModel(feature: AiFeature, modelId: string) {
  if (!realOpenaiModel) {
    throw new Error("The preload has not registered ../ai/provider.");
  }
  return realOpenaiModel(feature, modelId);
}

/** What the preload puts in place of `openaiModel`. Same signature. */
export function scriptedModel(feature: AiFeature, modelId: string) {
  return new MockLanguageModelV4({
    provider: "scripted",
    modelId,
    doGenerate: async (options): Promise<GenerateResult> => {
      const call = recorded(feature, modelId, options);
      calls.push(call);

      const script = scripts.get(feature);
      if (!script) {
        const err = new Error(
          `No model answer scripted for "${feature}" (${modelId}). ` +
            `Call scriptModel("${feature}", …) before the code under test asks.`,
        );
        unscripted.push(err);
        throw err;
      }

      const answered = calls.filter((c) => c.feature === feature).length;
      const answer = script[Math.min(answered, script.length) - 1];

      if ("throws" in answer) throw answer.throws;
      if ("hangs" in answer) return hang(options.abortSignal);
      return {
        content: [{ type: "text", text: answer.text }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: answer.usage ?? NO_USAGE,
        warnings: [],
      };
    },
  });
}
