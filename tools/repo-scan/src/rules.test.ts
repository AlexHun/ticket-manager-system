import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
  checkRules,
  offendingLines,
  type Rule,
  ruleCode,
  type TestRunner,
  underAny,
} from "./rules.ts";

// The runner both standards guards hand their rule tables to (#567, R2). Each
// guard's own `catches`, `passes` and `ignores` cases are its rules' tests;
// these are the runner's, over a planted rule and a planted tree.

const REPO_ROOT = path.resolve(import.meta.dir, "../../..");

const RULE: Rule = {
  name: "No direct fetch(",
  standard: "frontend.md",
  roots: ["web/src"],
  forms: [/(?<![\w$])fetch\s*\(/, /\bXMLHttpRequest\b/],
  allowed: ["web/src/lib/api.ts"],
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
const HOLDS = `${TITLE} > holds across web/src`;
const ROOTS = `${TITLE} > reads a file under each of its roots`;
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
  test("registers a holds test named by the rule's roots, the roots and allowlist checks, and one test per catches, passes and ignores example", () => {
    const { runner, tests } = recorder();
    checkRules([RULE], tree({ "web/src/lib/api.ts": "" }), runner);
    expect([...tests.keys()]).toEqual([
      HOLDS,
      ROOTS,
      `${TITLE} > its allowlist names files that exist`,
      `${TITLE} > catches await fetch("/api");`,
      `${TITLE} > passes await prefetch("/api");`,
      `${TITLE} > ignores a comment that only mentions the form`,
    ]);
  });

  test("every test passes for a rule whose examples are right", () => {
    const { runner, tests, failure } = recorder();
    checkRules([RULE], tree({ "web/src/lib/api.ts": "" }), runner);
    expect([...tests.keys()].map(failure)).toEqual(Array(6).fill(undefined));
  });

  test("the holds test fails on a breach, naming the file, the line and the rule, and skips an allowed file", () => {
    const { runner, failure } = recorder();
    const code = tree({
      "web/src/lib/api.ts": `fetch("/ok");`,
      "web/src/pages/A.tsx": `a();\nfetch("/no");`,
    });
    checkRules([RULE], code, runner);
    expect(failure(HOLDS)).toContain(
      "web/src/pages/A.tsx:2 breaks: No direct fetch( (docs/standards/frontend.md)",
    );
  });

  test("the holds test reads only files under the rule's roots that its applies accepts", () => {
    const { runner, failure } = recorder();
    const code = tree({
      "web/src/lib/api.ts": "",
      "web/src/test/x.ts": `fetch("/test");`,
      "web/dev/y.ts": `fetch("/dev");`,
      // Shares the root's prefix without being under it.
      "web/src-old/z.ts": `fetch("/old");`,
    });
    checkRules(
      [{ ...RULE, applies: (file) => !file.startsWith("web/src/test/") }],
      code,
      runner,
    );
    expect(failure(HOLDS)).toBeUndefined();
  });

  test("a root may be one file, and every root is read", () => {
    const { runner, failure, tests } = recorder();
    const code = tree({
      "web/src/lib/api.ts": "",
      "web/vite.config.ts": `fetch("/config");`,
    });
    checkRules(
      [{ ...RULE, roots: ["web/src", "web/vite.config.ts"] }],
      code,
      runner,
    );
    expect(tests.has(`${HOLDS}, web/vite.config.ts`)).toBe(true);
    expect(failure(`${HOLDS}, web/vite.config.ts`)).toContain(
      "web/vite.config.ts:1 breaks:",
    );
  });

  test("the roots check fails on a root under which the rule reads no file", () => {
    const { runner, failure } = recorder();
    const code = tree({
      "web/src/lib/api.ts": "",
      "web/dev/test/x.ts": "",
    });
    checkRules(
      [
        {
          ...RULE,
          roots: ["web/src", "web/dev", "scripts"],
          applies: (file) => !file.startsWith("web/dev/test/"),
        },
      ],
      code,
      runner,
    );
    const message = failure(ROOTS);
    expect(message).toContain("web/dev is a root, and the rule reads no file");
    expect(message).toContain("scripts is a root");
    expect(message).not.toContain("web/src is a root");
  });

  test("the allowlist check fails on an allowed file the scan does not read", () => {
    const { runner, failure } = recorder();
    checkRules([RULE], tree({ "web/src/lib/client.ts": "" }), runner);
    expect(
      failure(`${TITLE} > its allowlist names files that exist`),
    ).toContain("web/src/lib/api.ts");
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
      tree({ "web/src/lib/api.ts": "" }),
      runner,
    );
    expect(failure(`${TITLE} > catches await axios("/api");`)).toBeDefined();
    expect(failure(`${TITLE} > passes fetch("/api");`)).toBeDefined();
    expect(
      failure(`${TITLE} > ignores a comment that only mentions the form`),
    ).toBeDefined();
  });
});

describe("underAny", () => {
  test("holds for a root itself and anything under it, not for a path that only shares its prefix", () => {
    const roots = ["apps/web", "scripts/graph.ts"];
    expect(underAny(roots, "apps/web/src/a.ts")).toBe(true);
    expect(underAny(roots, "scripts/graph.ts")).toBe(true);
    expect(underAny(roots, "apps/webhooks/b.ts")).toBe(false);
    expect(underAny(roots, "scripts/graph.ts.bak")).toBe(false);
  });
});

describe("ruleCode", () => {
  const rules = [
    { ...RULE, roots: ["tools/repo-scan/src"] },
    { ...RULE, roots: ["tools/repo-scan/package.json", "scripts"] },
  ];

  test("reads every tracked source file under any rule's root, by repo-relative path, comment-stripped", () => {
    const code = ruleCode(rules, { root: REPO_ROOT });
    expect(code.has("tools/repo-scan/src/rules.ts")).toBe(true);
    expect(code.has("scripts/graph.ts")).toBe(true);
    expect(code.has("scripts/ci/record-changelog-entry.mjs")).toBe(true);
    // Under no rule's root.
    expect(code.has("apps/api/src/index.ts")).toBe(false);
    // A root, but not source.
    expect(code.has("tools/repo-scan/package.json")).toBe(false);
    expect(code.get("tools/repo-scan/src/rules.ts")).not.toContain(
      "The one rule shape and runner",
    );
  });

  test("skips the files it is told to", () => {
    const code = ruleCode(rules, {
      root: REPO_ROOT,
      skip: ["tools/repo-scan/src/rules.test.ts"],
    });
    expect(code.has("tools/repo-scan/src/rules.test.ts")).toBe(false);
    expect(code.has("tools/repo-scan/src/rules.ts")).toBe(true);
  });
});
