import { describe, expect, test } from "bun:test";
import {
  checkRules,
  offendingLines,
  type Rule,
  type TestRunner,
} from "./rules.ts";

// The runner both standards guards hand their rule tables to (#567, R2). Each
// guard's own `catches`, `passes` and `ignores` cases are its rules' tests;
// these are the runner's, over a planted rule and a planted tree.

const RULE: Rule = {
  name: "No direct fetch(",
  standard: "frontend.md",
  forms: [/(?<![\w$])fetch\s*\(/, /\bXMLHttpRequest\b/],
  allowed: ["src/lib/api.ts"],
  catches: [`await fetch("/api");`],
  passes: [`await prefetch("/api");`],
  ignores: `// Never fetch() directly.`,
};

/** A runner that records each test instead of registering it, so a test here
 *  can run one and see whether it failed. */
function recorder() {
  const tests = new Map<string, () => void>();
  let scope = "";
  const runner: TestRunner = {
    describe: (name, body) => {
      scope = name;
      body();
    },
    test: (name, body) => tests.set(`${scope} > ${name}`, body),
    expect,
  };
  /** The message the named test fails with, or `undefined` when it passes. */
  const failure = (name: string) => {
    const body = tests.get(name);
    if (!body)
      throw new Error(`no test named ${name}: ${[...tests.keys()].join(", ")}`);
    try {
      body();
      return undefined;
    } catch (error) {
      return String(error);
    }
  };
  return { runner, tests, failure };
}

const TITLE = "frontend.md: No direct fetch(";
const tree = (files: Record<string, string>) => new Map(Object.entries(files));

describe("offendingLines", () => {
  test("names each line a form matches, once however many forms match it", () => {
    const code = `a();\nfetch("/x"); new XMLHttpRequest();\nb();\nfetch("/y");`;
    expect(offendingLines(RULE, code)).toEqual([2, 4]);
  });

  test("keeps a form's own flags", () => {
    expect(offendingLines({ forms: [/FETCH\(/i] }, "fetch(")).toEqual([1]);
  });
});

describe("checkRules", () => {
  test("registers a holds test, the allowlist check, and one test per catches, passes and ignores example", () => {
    const { runner, tests } = recorder();
    checkRules(
      [RULE],
      { code: tree({ "src/lib/api.ts": "" }), across: "src/" },
      runner,
    );
    expect([...tests.keys()]).toEqual([
      `${TITLE} > holds across src/`,
      `${TITLE} > its allowlist names files that exist`,
      `${TITLE} > catches await fetch("/api");`,
      `${TITLE} > passes await prefetch("/api");`,
      `${TITLE} > ignores a comment that only mentions the form`,
    ]);
  });

  test("every example test passes for a rule whose examples are right", () => {
    const { runner, tests, failure } = recorder();
    checkRules(
      [RULE],
      { code: tree({ "src/lib/api.ts": "" }), across: "src/" },
      runner,
    );
    expect([...tests.keys()].map(failure)).toEqual(Array(5).fill(undefined));
  });

  test("the holds test fails on a breach, naming the file, the line and the rule, and skips an allowed file", () => {
    const { runner, failure } = recorder();
    const code = tree({
      "src/lib/api.ts": `fetch("/ok");`,
      "src/pages/A.tsx": `a();\nfetch("/no");`,
    });
    checkRules([RULE], { code, across: "src/" }, runner);
    expect(failure(`${TITLE} > holds across src/`)).toContain(
      "src/pages/A.tsx:2 breaks: No direct fetch( (docs/standards/frontend.md)",
    );
  });

  test("the holds test reads only the files the rule applies to and the scan reads for it", () => {
    const { runner, failure } = recorder();
    const code = tree({
      "src/lib/api.ts": "",
      "dev/x.ts": `fetch("/dev");`,
      "tests/e2e/y.ts": `fetch("/e2e");`,
    });
    checkRules(
      [{ ...RULE, applies: (file) => !file.startsWith("dev/") }],
      { code, across: "src/", reads: (_, file) => !file.startsWith("tests/") },
      runner,
    );
    expect(failure(`${TITLE} > holds across src/`)).toBeUndefined();
  });

  test("the allowlist check fails on an allowed file the scan does not read", () => {
    const { runner, failure } = recorder();
    checkRules(
      [RULE],
      { code: tree({ "src/lib/client.ts": "" }), across: "src/" },
      runner,
    );
    expect(
      failure(`${TITLE} > its allowlist names files that exist`),
    ).toContain("src/lib/api.ts");
  });

  test("an example the rule gets wrong fails its own test", () => {
    const { runner, failure } = recorder();
    checkRules(
      [
        {
          ...RULE,
          catches: [`await axios("/api");`],
          passes: [`fetch("/api");`],
          ignores: `fetch("/api");`,
        },
      ],
      { code: tree({ "src/lib/api.ts": "" }), across: "src/" },
      runner,
    );
    expect(failure(`${TITLE} > catches await axios("/api");`)).toBeDefined();
    expect(failure(`${TITLE} > passes fetch("/api");`)).toBeDefined();
    expect(
      failure(`${TITLE} > ignores a comment that only mentions the form`),
    ).toBeDefined();
  });

  test("the scope a holds test names can depend on the rule", () => {
    const { runner, tests } = recorder();
    checkRules(
      [RULE],
      {
        code: tree({ "src/lib/api.ts": "" }),
        across: (rule) => `${rule.standard} files`,
      },
      runner,
    );
    expect(tests.has(`${TITLE} > holds across frontend.md files`)).toBe(true);
  });
});
