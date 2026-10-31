import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { partialCheckout } from "@ticket/repo-scan/checkout";
import { type Pair, replaceOnce } from "./replace-once";
import { REPO_ROOT } from "./test/run-hook";

const BOM = String.fromCharCode(0xfeff);

describe("replaceOnce", () => {
  test("replaces each pair that occurs exactly once, in order", () => {
    const text = "alpha beta gamma\n";
    expect(
      replaceOnce(text, [
        ["beta", "BETA"],
        ["BETA gamma", "delta"],
      ]),
    ).toBe("alpha delta\n");
  });

  test("a newline in a pair matches CRLF, and the replacement keeps CRLF", () => {
    const text = "one\r\ntwo\r\nthree\r\n";
    expect(replaceOnce(text, [["one\ntwo\n", "1\n2\n"]])).toBe(
      "1\r\n2\r\nthree\r\n",
    );
  });

  test("a replacement keeps LF where the match was LF", () => {
    expect(replaceOnce("one\ntwo\n", [["one\ntwo", "1\n2"]])).toBe("1\n2\n");
  });

  test("a replacement with no newline in its match takes the file's own endings", () => {
    expect(replaceOnce("a\r\nb\r\n", [["b", "b\nc"]])).toBe("a\r\nb\r\nc\r\n");
  });

  test("dollar signs in a replacement are written as typed", () => {
    expect(replaceOnce("price", [["price", "$& $1 $$"]])).toBe("$& $1 $$");
  });

  test("a leading byte order mark is dropped", () => {
    expect(replaceOnce(`${BOM}docs: x\n`, [["x", "y"]])).toBe("docs: y\n");
  });

  test("throws naming every pair that matches no times or more than once", () => {
    const text = "one two two\n";
    expect(() =>
      replaceOnce(text, [
        ["one", "1"],
        ["two", "2"],
        ["three", "3"],
      ]),
    ).toThrow(
      'replace-once: pair 2 ("two") matches 2 times\nreplace-once: pair 3 ("three") matches 0 times',
    );
  });

  test("overlapping occurrences each count", () => {
    expect(() => replaceOnce("aaa", [["aa", "X"]])).toThrow(
      'replace-once: pair 1 ("aa") matches 2 times',
    );
  });

  test("an empty search string is refused", () => {
    expect(() => replaceOnce("text", [["", "x"]])).toThrow(
      "replace-once: pair 1 has an empty search string",
    );
  });

  test("revert undoes chained pairs, last first", () => {
    const pairs: Pair[] = [
      ["beta", "BETA"],
      ["BETA gamma", "delta"],
    ];
    const edited = replaceOnce("alpha beta gamma\n", pairs);
    expect(replaceOnce(edited, pairs, { revert: true })).toBe(
      "alpha beta gamma\n",
    );
  });
});

// The script is under `scripts/`, which the develop image does not carry.
describe.skipIf(partialCheckout)("bun scripts/replace-once.ts", () => {
  const SCRIPT = path.join(REPO_ROOT, "scripts/replace-once.ts");
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "replace-once-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const run = (...args: string[]) => {
    const result = Bun.spawnSync(["bun", SCRIPT, ...args]);
    return { code: result.exitCode, stderr: result.stderr.toString() };
  };
  const writeFixture = (content: string, pairs: unknown) => {
    const file = path.join(dir, "target.ts");
    const pairsFile = path.join(dir, "pairs.json");
    writeFileSync(file, content);
    writeFileSync(pairsFile, JSON.stringify(pairs));
    return { file, pairsFile };
  };

  test("writes UTF-8 with no BOM, keeping every character it did not replace", () => {
    const { file, pairsFile } = writeFixture(
      "// a — b – c\r\nconst x = 1;\r\n",
      [["x = 1", "x = 2"]],
    );
    expect(run(file, pairsFile).code).toBe(0);
    const bytes = readFileSync(file);
    expect([...bytes.subarray(0, 3)]).toEqual([0x2f, 0x2f, 0x20]);
    expect(bytes.toString("utf8")).toBe("// a — b – c\r\nconst x = 2;\r\n");
  });

  test("writes nothing and exits 1 when any pair fails", () => {
    const content = "one two two\n";
    const { file, pairsFile } = writeFixture(content, [
      ["one", "1"],
      ["two", "2"],
    ]);
    const { code, stderr } = run(file, pairsFile);
    expect(code).toBe(1);
    expect(stderr).toContain('replace-once: pair 2 ("two") matches 2 times');
    expect(readFileSync(file, "utf8")).toBe(content);
  });

  test("--revert with the same pairs file restores the original", () => {
    const content = "if (ok) return;\n";
    const { file, pairsFile } = writeFixture(content, [
      ["if (ok)", "if (!ok)"],
    ]);
    expect(run(file, pairsFile).code).toBe(0);
    expect(readFileSync(file, "utf8")).toBe("if (!ok) return;\n");
    expect(run("--revert", file, pairsFile).code).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(content);
  });

  test("reads a pairs file that starts with a byte order mark", () => {
    const { file, pairsFile } = writeFixture("a\n", []);
    writeFileSync(pairsFile, `${BOM}[["a", "b"]]`);
    expect(run(file, pairsFile).code).toBe(0);
    expect(readFileSync(file, "utf8")).toBe("b\n");
  });

  test("refuses a pairs file that is not a list of string pairs", () => {
    const { file, pairsFile } = writeFixture("text\n", [["only one"]]);
    const { code, stderr } = run(file, pairsFile);
    expect(code).toBe(1);
    expect(stderr).toContain("is not a JSON list of [from, to] string pairs");
  });
});
