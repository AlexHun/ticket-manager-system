import { stripComments } from "./strip-comments.ts";

/**
 * The one rule shape and runner behind both standards guards (#567,
 * `docs/prd/one-repo-scanner.md` R2): `apps/api/src/standards-guard.test.ts`
 * (#391) and `apps/web/dev/standards-guard.test.ts` (#390) each hold a table of
 * rules and hand it to `checkRules`, with the files they read. Before, each
 * guard had its own copy of `offendingLines` and its own rule type, and only
 * the web one's rules could say what must pass.
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
  /** The banned forms. Each is matched against comment-stripped source. */
  forms: RegExp[];
  /** Which of the guard's files the rule reads. Every one when absent. */
  applies?: (file: string) => boolean;
  /** Files where the form is the point rather than a violation. Each must be
   *  a file the guard reads, or the check below fails. */
  allowed?: string[];
  /** Lines that break the rule, each of which must be caught. */
  catches: string[];
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

/** What a guard reads, as `checkRules` needs it. */
export interface RuleScan<R extends Rule = Rule> {
  /** Every file the guard reads, comment-stripped, keyed by the path its
   *  rules' `applies` and `allowed` name. */
  code: ReadonlyMap<string, string>;
  /** Where a rule's holds test says it reads: `holds across <across>`. */
  across: string | ((rule: R) => string);
  /** Whether `rule` reads `file`. When absent, the rule's own `applies`
   *  decides; a guard whose files are not all alike (the web guard's
   *  `tests/e2e`) answers here, and asks `applies` itself where it should. */
  reads?: (rule: R, file: string) => boolean;
}

const appliesTo = (rule: Rule, file: string) => rule.applies?.(file) !== false;

/** The parts of `bun:test` and Vitest the runner registers its tests with. */
export interface TestRunner {
  describe: (name: string, body: () => void) => void;
  test: (name: string, body: () => void) => void;
  expect: (actual: unknown) => {
    toEqual: (expected: unknown) => void;
  };
}

const label = (rule: Rule) => `${rule.name} (docs/standards/${rule.standard})`;

/**
 * One `describe` per rule, holding five kinds of test: the rule holds across
 * every file it reads; every allowlisted file is one the guard reads, since a
 * renamed exemption would leave the rule guarding nothing there and failing
 * nothing, which reads exactly like a clean tree; and each `catches`, `passes`
 * and `ignores` example does what it says.
 */
export function checkRules<R extends Rule>(
  rules: readonly R[],
  scan: RuleScan<R>,
  { describe, test, expect }: TestRunner,
): void {
  const reads = scan.reads ?? appliesTo;
  for (const rule of rules) {
    const across =
      typeof scan.across === "string" ? scan.across : scan.across(rule);
    describe(`${rule.standard}: ${rule.name}`, () => {
      test(`holds across ${across}`, () => {
        const offenders: string[] = [];
        for (const [file, code] of scan.code) {
          if (!reads(rule, file) || rule.allowed?.includes(file)) continue;
          for (const line of offendingLines(rule, code)) {
            offenders.push(`${file}:${line} breaks: ${label(rule)}`);
          }
        }
        expect(offenders).toEqual([]);
      });

      test("its allowlist names files that exist", () => {
        expect(
          (rule.allowed ?? [])
            .filter((file) => !scan.code.has(file))
            .map(
              (file) =>
                `${file} is allowed by, and not read for: ${label(rule)}`,
            ),
        ).toEqual([]);
      });

      for (const line of rule.catches) {
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
