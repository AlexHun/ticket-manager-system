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
  (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
);

const source = (name: string) => readFileSync(join(DIR, name), "utf8");

/** The package files a domain file imports a value from, by name. */
const valueImports = (name: string): string[] =>
  [
    ...source(name).matchAll(
      /^import\s+(type\s+)?(?:\{([^}]*)\}|[\w*\s]+)\s+from\s+"\.\/([\w-]+\.ts)"/gm,
    ),
  ]
    .filter(([, typeOnly, specifiers]) => {
      if (typeOnly) return false;
      if (specifiers === undefined) return true;
      return specifiers
        .split(",")
        .map((specifier) => specifier.trim())
        .some(
          (specifier) => specifier !== "" && !specifier.startsWith("type "),
        );
    })
    .map(([, , , target]) => target!);

describe("the package index", () => {
  test("holds re-exports of the domain files and nothing else", () => {
    const definitions = source("index.ts")
      .split(/\r?\n/)
      .map((line, i) => `${i + 1}: ${line}`)
      .filter(
        (line) => !/^\d+: (export \* from "\.\/[\w-]+\.ts";)?$/.test(line),
      );
    // The first few say where; the whole block would bury them.
    expect(definitions.slice(0, 3)).toEqual([]);
  });

  test("re-exports every domain file", () => {
    const reExported = [
      ...source("index.ts").matchAll(/^export \* from "\.\/([\w-]+\.ts)";$/gm),
    ].map(([, target]) => target);
    expect(reExported.sort()).toEqual(
      domainFiles.filter((name) => name !== "index.ts").sort(),
    );
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
