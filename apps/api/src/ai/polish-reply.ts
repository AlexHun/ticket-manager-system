import { isPolishConfigured } from "./polish";

/**
 * Whether `POST /api/ai/polish-reply` can polish — the one question
 * `routes/ai.ts` asks of `./polish` that its test needs to answer itself.
 *
 * One line of work, and a module of its own for a measured reason rather than
 * a stylistic one — the reason `evals/measure-case.ts` is one
 * (`docs/adr/0016`, testing-api.md). `routes/ai.test.ts` used to register
 * `mock.module("../ai/polish", …)` with `polishDraft` and `isPolishConfigured`
 * replaced, and `ai/polish.test.ts` imports `./polish` to test those very
 * functions. The registry is one process wide, so when `routes/` loads ahead
 * of `ai/` — which a reverse-order run does (#303) — `polish.test.ts` imported
 * the route's stub and twenty-four of its tests went red. A module only the route imports gives
 * its test a specifier nothing else loads for real.
 *
 * A function, never `export { … } from "./polish"`: a re-export's binding is
 * the source module's own, so a factory that rewires this module once it has
 * been evaluated rewrites `./polish` with it. `evals/reply-to-case.ts` records
 * the run that measured it.
 *
 * The route calls `polishDraft` from `./polish` directly since #578: the
 * model's answer is scripted on the preload's fake model (`src/test/model.ts`),
 * so nothing replaces the rewrite itself any more.
 */
export function isPolishReplyConfigured(): boolean {
  return isPolishConfigured();
}
