import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The package's layout, held by a test (#583, `docs/prd/split-shared.md` R1
 * and R5). Each domain's vocabulary lives in a file of its own, and the index
 * only gathers them: a definition added to the index puts a domain back in a
 * file nobody would look for it in, which is what the split undid.
 *
 * Several domain files key one constant on another's while the module loads —
 * `DECLINE_STAGE` on `AUTO_REPLY_DECLINE`, `DEMO_SEES_ADMIN_SCREEN` on
 * `ADMIN_SCREEN` — so a cycle of value imports between two of them would read
 * a constant before it is set. A type-only import leaves nothing at runtime
 * and cannot close one.
 */

const DIR = import.meta.dir;

const domainFiles = readdirSync(DIR).filter(
  (name) =>
    name.endsWith(".ts") && !name.endsWith(".test.ts") && name !== "index.ts",
);

const source = (name: string) => readFileSync(join(DIR, name), "utf8");

/** The one line the index may hold. */
const RE_EXPORT = /^export \* from "\.\/([\w-]+\.ts)";$/;

/**
 * Every `import` or `export … from` of a package file, its clause, and a bare
 * `import "./x"` with none. Either quote, with or without `.ts`.
 */
const FROM_PACKAGE_FILE =
  /^(?:import|export)\s+([^;'"]*?)\s*from\s+["']\.\/([\w-]+?)(?:\.ts)?["']|^import\s+["']\.\/([\w-]+?)(?:\.ts)?["']/gm;

/** Whether an import or re-export clause binds anything at runtime. */
const bindsValue = (clause: string | undefined) => {
  if (clause === undefined) return true;
  if (/^type\b/.test(clause)) return false;
  const named = /\{([^}]*)\}/.exec(clause)?.[1] ?? "";
  const unbraced = clause.replace(/\{[^}]*\}/, "").replace(/[\s,]/g, "");
  return (
    unbraced !== "" ||
    named
      .split(",")
      .map((specifier) => specifier.trim())
      .some((specifier) => specifier !== "" && !/^type\b/.test(specifier))
  );
};

/** The package files a domain file imports or re-exports a value from. */
const valueImports = (name: string): string[] =>
  [...source(name).matchAll(FROM_PACKAGE_FILE)]
    .filter(([, clause, , bare]) => bindsValue(bare ? undefined : clause))
    .map(([, , target, bare]) => `${target ?? bare}.ts`);

describe("the package index", () => {
  test("holds re-exports of the domain files and nothing else", () => {
    const definitions = source("index.ts")
      .split(/\r?\n/)
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => line !== "" && !RE_EXPORT.test(line))
      .map(([n, line]) => `${n}: ${line}`);
    // The first few say where; the whole block would bury them.
    expect(definitions.slice(0, 3)).toEqual([]);
  });

  test("re-exports every domain file", () => {
    const reExported = source("index.ts")
      .split(/\r?\n/)
      .map((line) => RE_EXPORT.exec(line)?.[1])
      .filter((target) => target !== undefined);
    expect(reExported.sort()).toEqual(domainFiles.sort());
  });
});

describe("the domain files", () => {
  test("are each 600 lines or fewer", () => {
    const over = domainFiles.filter(
      (name) => source(name).trimEnd().split(/\r?\n/).length > 600,
    );
    expect(over).toEqual([]);
  });

  test("import no value along a cycle", () => {
    const cycles: string[] = [];
    const walk = (name: string, path: string[]) => {
      for (const target of valueImports(name)) {
        if (target === path[0]) cycles.push([...path, target].join(" → "));
        else if (!path.includes(target)) walk(target, [...path, target]);
      }
    };
    for (const name of domainFiles) walk(name, [name]);
    expect(cycles).toEqual([]);
  });
});
