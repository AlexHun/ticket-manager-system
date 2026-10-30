import { readFileSync } from "node:fs";
import path from "node:path";
import { inEveryQuote } from "./spellings.ts";
import { stripComments } from "./strip-comments.ts";
import { trackedFiles } from "./tracked-files.ts";

/**
 * The one rule shape and runner behind both standards guards (#567,
 * `docs/prd/one-repo-scanner.md` R2): `apps/api/src/standards-guard.test.ts`
 * (#391) and `apps/web/dev/standards-guard.test.ts` (#390) each hold a table of
 * rules and hand it to `checkRules`, with the files `ruleCode` reads for it.
 * Before, each guard had its own copy of `offendingLines` and its own rule
 * type, and only the web one's rules could say what must pass.
 *
 * **Each rule names its own roots** (#568, R6), as paths from the repository
 * root, so a rule can reach `packages/` and `scripts/` and a reader of the
 * table sees where each one applies. The holds test is titled by them.
 *
 * **It takes the test runner as an argument.** The API suite is `bun test` and
 * the web suite is Vitest, and neither guard may depend on the other's runner,
 * so this module imports neither: a guard passes its own `describe`, `test` and
 * `expect`.
 *
 * Matching runs over `stripComments`' output, so a rule matches a form in code
 * and never one a comment only explains.
 */

export interface Rule {
  /** The bullet, in a sentence a failing run can be acted on from. */
  name: string;
  /** The standards file the bullet lives in, under `docs/standards/`. */
  standard: string;
  /** Where the rule applies: repo-relative directories, or single files, each
   *  of which it reads every tracked source file under (#568, R6). */
  roots: string[];
  /** The banned forms. Each is matched against comment-stripped source. */
  forms: RegExp[];
  /** Which files under its roots the rule reads, by repo-relative path. Every
   *  one when absent. */
  applies?: (file: string) => boolean;
  /** Files where the form is the point rather than a violation, by
   *  repo-relative path. Each must be a file the guard reads, or `checkRules`'
   *  allowlist test fails. */
  allowed?: string[];
  /** Lines that break the rule, each of which must be caught — and caught
   *  again with its double-quoted literals rewritten in single quotes and in
   *  backticks (`inEveryQuote`), unless `asTyped` says why not. */
  catches: string[];
  /** Why the rule bans a literal only in the quote its `catches` are typed
   *  in, when another quote is not the same mistake. Absent, every quote is. */
  asTyped?: string;
  /** Lines that keep the rule while resembling a break, each of which must
   *  pass. */
  passes?: string[];
  /** A comment that only mentions the form, and must be ignored. */
  ignores: string;
}

/** The 1-based line numbers in `code` where any of the rule's forms matches,
 *  each once however many forms match it. */
export function offendingLines(
  rule: Pick<Rule, "forms">,
  code: string,
): number[] {
  const lines = new Set<number>();
  for (const form of rule.forms) {
    // The form's own flags kept: a `/u` or `/i` form must not lose them here.
    const global = new RegExp(form.source, `${form.flags.replace("g", "")}g`);
    for (const match of code.matchAll(global)) {
      lines.add(code.slice(0, match.index).split("\n").length);
    }
  }
  return [...lines].sort((a, b) => a - b);
}

/** Whether `file` is `root`, or under it. */
const isUnder = (file: string, root: string) =>
  file === root || file.startsWith(`${root}/`);

/** Whether `file` is one of `roots`, or under one: a repo-relative path, as a
 *  rule's roots name it. */
export const underAny = (roots: readonly string[], file: string): boolean =>
  roots.some((root) => isUnder(file, root));

/** Whether `rule` reads `file`: under one of its roots, and not turned away
 *  by its `applies`. */
const reads = (rule: Rule, file: string) =>
  underAny(rule.roots, file) && rule.applies?.(file) !== false;

/** The files a rule can read: TypeScript and JavaScript source. Nothing a
 *  root holds besides (`.sql` migrations, JSON fixtures) is code. */
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;

/**
 * Every tracked source file under any of `rules`' roots, comment-stripped and
 * keyed by its path from `root`, the repository: what `checkRules` matches
 * the rules against. A file in `skip` is not read; a guard skips itself,
 * since it holds every banned form as a fixture.
 */
export function ruleCode(
  rules: readonly Rule[],
  {
    root,
    skip = [],
    tracked = trackedFiles(root),
  }: {
    root: string;
    skip?: readonly string[];
    /** `trackedFiles(root)`, for a guard that has listed it already. */
    tracked?: readonly string[];
  },
): Map<string, string> {
  return new Map(
    tracked
      .filter(
        (file) =>
          SOURCE.test(file) &&
          !skip.includes(file) &&
          rules.some((rule) => underAny(rule.roots, file)),
      )
      .map((file) => [
        file,
        stripComments(readFileSync(path.join(root, file), "utf8")).code,
      ]),
  );
}

/** The parts of `bun:test` and Vitest the runner registers its tests with. */
export interface TestRunner {
  describe: (name: string, body: () => void) => void;
  test: (name: string, body: () => void) => void;
  expect: (actual: unknown) => {
    toEqual: (expected: unknown) => void;
  };
}

/** A rule named as a failure names it: its bullet, and the standards file. */
export const ruleLabel = (rule: { name: string; standard: string }): string =>
  `${rule.name} (docs/standards/${rule.standard})`;

/**
 * One `describe` per rule, over `code` (`ruleCode`'s map), holding six kinds
 * of test: the rule holds across every file it reads; it reads at least one
 * file under each root, since a root that moved, or that `applies` turns
 * wholly away, is the rule guarding nothing there and failing nothing, which
 * reads exactly like a clean tree; every allowlisted file is one the guard
 * reads, for the same reason; and each `catches`, `passes` and `ignores`
 * example does what it says.
 */
export function checkRules(
  rules: readonly Rule[],
  code: ReadonlyMap<string, string>,
  { describe, test, expect }: TestRunner,
): void {
  for (const rule of rules) {
    describe(`${rule.standard}: ${rule.name}`, () => {
      test(`holds across ${rule.roots.join(", ")}`, () => {
        const offenders: string[] = [];
        for (const [file, source] of code) {
          if (!reads(rule, file) || rule.allowed?.includes(file)) continue;
          for (const line of offendingLines(rule, source)) {
            offenders.push(`${file}:${line} breaks: ${ruleLabel(rule)}`);
          }
        }
        expect(offenders).toEqual([]);
      });

      test("reads a file under each of its roots", () => {
        const files = [...code.keys()].filter((file) => reads(rule, file));
        expect(
          rule.roots
            .filter((root) => !files.some((file) => isUnder(file, root)))
            .map(
              (root) =>
                `${root} is a root, and the rule reads no file under it: ${ruleLabel(rule)}`,
            ),
        ).toEqual([]);
      });

      test("its allowlist names files that exist", () => {
        expect(
          (rule.allowed ?? [])
            .filter((file) => !code.has(file))
            .map(
              (file) =>
                `${file} is allowlisted, and the guard does not read it: ${ruleLabel(rule)}`,
            ),
        ).toEqual([]);
      });

      const catches = rule.asTyped
        ? rule.catches
        : rule.catches.flatMap(inEveryQuote);
      for (const line of catches) {
        test(`catches ${line}`, () => {
          expect(offendingLines(rule, stripComments(line).code)).toEqual([1]);
        });
      }

      for (const line of rule.passes ?? []) {
        test(`passes ${line}`, () => {
          expect(offendingLines(rule, stripComments(line).code)).toEqual([]);
        });
      }

      test("ignores a comment that only mentions the form", () => {
        expect(offendingLines(rule, stripComments(rule.ignores).code)).toEqual(
          [],
        );
      });
    });
  }
}
