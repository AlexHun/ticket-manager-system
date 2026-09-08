import { isAiConfigured } from "../ai/provider";

/**
 * Whether this deployment can run an eval at all.
 *
 * One line over `isAiConfigured`, kept as its own name for exactly the reason
 * `isPolishConfigured()` and `isSummarizeConfigured()` are (testing.md, #174).
 * There is one key behind every AI feature, so "can polish" and "can run an
 * eval" are the same question — but a route or a registration that reads
 * `isAiConfigured` **directly** forces its test file onto the `../ai/provider`
 * specifier, which `jobs/sweeps.test.ts` already owns with a *stateful* stub.
 * Two stateful copies are two boxes, of which the process-wide registry keeps
 * one, leaving the other file's switch inert. A guard of its own gives each
 * caller's test a specifier nothing else touches.
 *
 * Its own leaf module rather than an export on `./runner`, so a route test that
 * only wants to say "this deployment has no key" does not have to stand in for
 * the module that calls the model.
 *
 * `AUTO_REPLY_ENABLED` is deliberately **not** consulted. That switch stops the
 * desk answering real customers; an eval answers a synthesized input and writes
 * to nobody, so a deployment that has turned the feature off is precisely one
 * where measuring it still makes sense — it is how you find out whether it is
 * safe to turn back on. The key is the only gate (ADR-0003).
 */
export function isEvalConfigured(): boolean {
  return isAiConfigured();
}
