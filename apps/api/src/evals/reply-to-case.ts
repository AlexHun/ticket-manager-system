import {
  autoReply,
  type AutoReplyContext,
  type AutoReplyResult,
} from "../ai/auto-reply";
import type { KbArticle } from "../ai/knowledge-base";

/**
 * Ask the auto-reply about one repeat of a case — the one question
 * `runner.ts` asks of `../ai/auto-reply` that its test needs to answer itself.
 *
 * One line of work, and a module of its own for a measured reason rather than a
 * stylistic one — the reason `measure-case.ts` and `classify-case.ts` are theirs
 * (`docs/adr/0016`, testing-api.md). `runner.test.ts` used to register
 * `mock.module("../ai/auto-reply", …)` with `autoReply` replaced, and
 * `ai/auto-reply.test.ts` imports `./auto-reply` to test that very function.
 * The registry is one process wide, so when `evals/` loads ahead of `ai/` —
 * which a reverse-order run does (#303) — `auto-reply.test.ts` imported the
 * runner's stub and fifty-one of its tests went red. A module only the runner
 * imports gives its test a specifier nothing else loads for real.
 *
 * **A function, never `export { autoReply } from …`**, and that was measured
 * too. A re-export's binding *is* the source module's: once some earlier file
 * has evaluated this module for real (`jobs/eval-nightly.test.ts` does, through
 * `start-run` → `eval-run` → `runner`), `runner.test.ts`'s factory rewires it,
 * and rewiring a re-export rewrites `autoReply` in `../ai/auto-reply` itself —
 * the same fifty-one tests red, now behind a pair of files that is green on its
 * own and a third that has to have loaded first.
 */
export function replyToCase(
  articles: KbArticle[],
  context: AutoReplyContext,
  signal?: AbortSignal,
): Promise<AutoReplyResult> {
  return autoReply(articles, context, signal);
}
