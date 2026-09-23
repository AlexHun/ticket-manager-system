import type { AutoReplyCase } from "@ticket/core";
import type { KbArticle } from "../ai/knowledge-base";
import { runCase, type EvalCaseOutcome } from "./runner";

/**
 * Measure one case for a stored run — the one question `jobs/eval-run.ts` asks
 * of the runner that its test needs to answer itself.
 *
 * One line of work, and a module of its own for a measured reason rather than a
 * stylistic one — the same reason `schedule-queue.ts` is one (`docs/adr/0016`,
 * testing-api.md). `jobs/eval-run.test.ts` used to register
 * `mock.module("../evals/runner", …)` with `runCase` replaced, and
 * `evals/runner.test.ts` imports `./runner` to test that very function. The
 * registry is one process wide, so whichever of the two files loaded second
 * decided what the other got: when ubuntu-latest's directory walk put `jobs/`
 * ahead of `evals/` (run 35908384626), `runner.test.ts` destructured the stub
 * and fourteen of its tests read `repeats: undefined` off a fixture. A module
 * only the worker imports gives its test a specifier nothing else loads for
 * real, so neither file has to know the other exists.
 *
 * `EVAL_REPEATS` and `expectedCategoryOf` stay imported from `./runner`
 * directly: the worker's test wants those real, and nothing replaces them.
 */
export function measureCase(
  articles: KbArticle[],
  evalCase: AutoReplyCase,
  repeats: number,
): Promise<EvalCaseOutcome> {
  return runCase(articles, evalCase, repeats);
}
