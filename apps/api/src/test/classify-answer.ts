/**
 * The classifier's answer, scripted on the preload's fake model (#656).
 *
 * The model answers the JSON `Output.object` parses, and three test files
 * script it: `jobs/classify-ticket.test.ts`,
 * `jobs/activity-before-publish.test.ts` and `evals/runner.test.ts`. Typed off
 * the module's own `ClassifyAnswer` rather than a local copy of its shape
 * (testing-api.md, `docs/adr/0018`), so a field renamed in the schema fails to
 * compile here instead of reaching a test as an answer that will not parse.
 * The same shape as `./auto-reply-answer.ts`.
 */

// Type-only, so nothing here links `../ai/classify`, which links the provider,
// which reads its key at import.
import type { ClassifyAnswer } from "../ai/classify";
import type { ModelAnswer } from "./model";

/** The model files the ticket under `category`. */
export function classifyAnswer(
  category: ClassifyAnswer["category"],
): ModelAnswer {
  const answer: ClassifyAnswer = { category };
  return { text: JSON.stringify(answer) };
}
