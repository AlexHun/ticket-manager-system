/**
 * The auto-reply's answer, scripted on the preload's fake model (#580).
 *
 * The model answers the JSON `Output.object` parses, and three test files
 * script it: `ai/auto-reply.test.ts`, `jobs/auto-reply-ticket.test.ts` and
 * `evals/runner.test.ts`. Typed off the module's own `AutoReplyAnswer` rather
 * than a local copy of its shape (testing-api.md, `docs/adr/0018`), so a field
 * renamed in the schema fails to compile here instead of reaching a test as an
 * answer that will not parse.
 */

// Type-only, so nothing here links `../ai/auto-reply`, which links the
// provider, which reads its key at import.
import type { AutoReplyAnswer } from "../ai/auto-reply";
import type { ModelAnswer } from "./model";

/** The model answers `answer`. */
export function autoReplyAnswer(answer: AutoReplyAnswer): ModelAnswer {
  return { text: JSON.stringify(answer) };
}
