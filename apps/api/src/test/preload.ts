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
 * runs, and it fails loudly if it is ever resolved from the wrong directory;
 * the bunfig covers a bare `bun test <file>` from `apps/api`, and in
 * particular the `bun test <a> <b>` in both orders `testing.md` prescribes
 * before believing a new mock — a run with no preload has no sentinel either.
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
import { mock } from "bun:test";
import { Prisma, prisma } from "./pg";

// Deliberately before the registration below. `import` statements hoist above
// it, which is fine: neither `bun:test` nor `./pg` reads `DATABASE_URL` — the
// modules that do are linked later, when the first test file imports them.
process.env.DATABASE_URL =
  "postgresql://unreachable:unreachable@127.0.0.1:1/api-tests-must-mock-db";

mock.module("../db", () => ({ Prisma, prisma }));
