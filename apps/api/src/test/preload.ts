/**
 * `bun test --preload` for the API suite — the last step of ADR-0014 (#175).
 *
 * Every test file that reaches the database used to open with the same line:
 *
 *     mock.module("../db", () => ({ Prisma, prisma }));
 *
 * Sixteen copies of one binding, and the reason they were a hazard rather than
 * merely repetitive is in `docs/standards/testing.md`: `mock.module`'s registry
 * is one process wide and nothing resets it between files, so a specifier is
 * bound by whichever file was loaded first and the rest inherit it. While some
 * files still mocked `../db` with a hand-written client that mattered a great
 * deal. Now that they all name the *same* shared client it does not — and
 * registering it here, once, before any test file loads, is what turns "they
 * happen to agree" into "there is only one binding". Two workarounds go with
 * it: a factory no longer has to re-export a `Prisma` namespace the file never
 * touches, and two suites that mock `../db` no longer have to share a file.
 *
 * Wired in twice, deliberately: `package.json`'s `test` script passes it with
 * `--preload`, and `bunfig.toml` lists it under `[test]`. The flag is what CI
 * passes too, and it fails loudly if it is ever resolved from the wrong
 * directory; the bunfig covers a bare `bun test <file>` from `apps/api`, and in
 * particular the `bun test ./<a> ./<b>` in both orders `testing-api.md`
 * prescribes before believing a new mock — a run with no preload has no
 * sentinel either.
 * Bun evaluates a module once, so the two entries register one binding.
 *
 * ## The two things this file has to get exactly right
 *
 * **The specifier is resolved relative to *this* file.** `mock.module` resolves
 * its first argument the way an `import` written here would, not the way the
 * module under test wrote it. From `src/test/`, `"../db"` happens to land on
 * the same `src/db.ts` that `src/routes/*.ts` mean by `"../db"` — the strings
 * match by coincidence of depth, not by rule. Move this file and the string has
 * to move with it.
 *
 * **`DATABASE_URL` is overwritten first, and that is a safety interlock rather
 * than tidiness.** A `mock.module` registered under a path that matches nothing
 * *does not error*. The modules under test then link the real `../db`, which
 * connects to whatever `DATABASE_URL` names — on a developer's machine, the dev
 * database. This was hit during the #152 spike, where
 * `new URL("../src/db.ts", import.meta.url).pathname` yielded `/C:/…` on
 * Windows and silently missed; nothing was written, but only because the
 * requests failed before their writes landed. Pointing the variable at a
 * closed port first turns that silent fallthrough into a connection refusal on
 * the first query. `bun test` loads `.env`/`.env.test` before it evaluates a
 * preload, so there is always a real value here to overwrite.
 *
 * To check the interlock still works, break the specifier by hand — change
 * `"../db"` to `"../db-nope"` — and run the suite. It must go red with
 * connection failures, not green and not silently slow.
 */
import { afterEach, beforeEach, mock } from "bun:test";
import {
  PARTIAL_CHECKOUT_NOTE,
  partialCheckout,
} from "@ticket/repo-scan/checkout";
import { testSession } from "./caller";
import {
  aiSwitch,
  rememberRealOpenaiModel,
  resetModel,
  scriptedModel,
  unscripted,
} from "./model";
import { Prisma, prisma } from "./pg";

// Deliberately before the registration below. `import` statements hoist above
// it, which is fine: neither `bun:test`, `./model` nor `./pg` reads
// `DATABASE_URL` or the OpenAI variables below — the modules that do are linked
// later, `../ai/provider` by the dynamic import at the bottom of this file and
// the rest when the first test file imports them.
process.env.DATABASE_URL =
  "postgresql://unreachable:unreachable@127.0.0.1:1/api-tests-must-mock-db";

// A key, for the whole process, so that whether the provider is configured
// stops depending on file order (#303). `ai/provider.ts` reads it into a
// module-level `const` at import and Bun evaluates a module once, so the first
// file to link the provider decided for every file after it: eleven files that
// never set one each left `polish.test.ts`'s `isPolishConfigured()` false when
// loaded ahead of it, and forward order was green only because an `ai/` file
// that sets one got there first. A keyless deployment is a test that says so
// (`jobs/sweeps.test.ts`).
//
// Not a real key, and the base URL beside it is the same closed port as
// `DATABASE_URL` above, for the same reason: with a key set, a provider call a
// test forgot to mock would otherwise leave for OpenAI and come back `auth`.
// This way it fails at once, on this machine, with a connection refusal.
process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
process.env.OPENAI_BASE_URL = "http://127.0.0.1:1/v1";

await mock.module("../db", () => ({ Prisma, prisma }));

// Who is asking (#366). Every route test runs the real guards in
// `../middleware/auth`; this is the one question they ask that a test answers,
// from the `x-test-user` header `asCaller` writes and the `user` row it names.
// Here rather than in each file for `../db`'s reason above: fifteen files
// used to stub the guards themselves, and while any one of them did, the
// registry could hand another file that stub instead of the real guards.
// Same depth caveat as `"../db"`: this resolves from `src/test/`.
await mock.module("../middleware/session", () => ({
  lookupSession: testSession,
}));

// The model (#578). Every AI feature gets its model from `openaiModel`, and
// this replaces that one function with the scripted fake in `./model`, so a
// test scripts an answer instead of registering a stand-in of its own. Imported
// here, after the key above is set, because `provider.ts` reads it at import;
// and spread into a plain object before the registration, because
// `mock.module` replaces the live namespace and a factory spreading the import
// binding would be spreading itself (`testing-api.md`).
//
// `isAiConfigured` is the one other export replaced, and it is here rather
// than in `jobs/sweeps.test.ts`, which used to register this specifier for it:
// two stateful registrations of one specifier are two boxes, of which the
// registry keeps one (#174). It answers what the real one does until a test
// sets `aiSwitch.configured`, and the `beforeEach` below puts it back.
// Same depth caveat as `"../db"`: this resolves from `src/test/`.
const provider = { ...(await import("../ai/provider")) };
rememberRealOpenaiModel(provider.openaiModel);
await mock.module("../ai/provider", () => ({
  ...provider,
  openaiModel: scriptedModel,
  isAiConfigured: () => aiSwitch.configured ?? provider.isAiConfigured(),
}));

beforeEach(() => {
  resetModel();
  aiSwitch.configured = undefined;
});

// The loud half of an unscripted call. The fake throws, but every feature
// catches a provider error and answers with a result, so without this a test
// that forgot to script would pass on an ordinary-looking `provider` failure.
afterEach(() => {
  const missed = unscripted[0];
  if (missed) throw missed;
});

// Once per run, so the tests the develop image skips are not skipped silently
// (#585). Nowhere else is it set.
if (partialCheckout) console.warn(PARTIAL_CHECKOUT_NOTE);
