/**
 * One `classifyTicket` stub, shared by every test file that runs the classify
 * worker's success path (#561; lifted out of `jobs/activity-before-publish.test.ts`).
 *
 * The success path is the only one that reaches the model, so it is the only
 * one a test cannot reach without replacing `../ai/classify`. Two files need
 * it: `jobs/activity-before-publish.test.ts`, for the order the trail and the
 * event land in, and `jobs/classify-ticket.test.ts`, for what the write files.
 * Two factories on one specifier is the process-wide registry hazard
 * `docs/standards/testing-api.md` describes, and this one holds **state** — the
 * answer — so it is one module both files install, as `./send-email.ts` is.
 *
 * It **defaults to the real function**: with `classifyStub.answer` null, a call
 * goes through to `classifyTicket` as if nothing were registered. A file that
 * sets an answer resets it in the same `beforeEach` that calls `resetDb()`.
 */
import { mock } from "bun:test";
import type { ClassifyResult } from "../ai/classify";

export const classifyStub: { answer: ClassifyResult | null } = {
  answer: null,
};

let installed = false;

/** Register the stub, at module scope. Idempotent, as `stubSendEmail` is. */
export async function stubClassify(): Promise<void> {
  if (installed) return;
  installed = true;

  // Spread now, before the mock is registered, so the wrapper below calls the
  // real function rather than itself.
  const actual = { ...(await import("../ai/classify")) };

  await mock.module("../ai/classify", () => ({
    ...actual,
    classifyTicket: async (
      ...args: Parameters<typeof actual.classifyTicket>
    ): Promise<ClassifyResult> =>
      classifyStub.answer ?? actual.classifyTicket(...args),
  }));
}
