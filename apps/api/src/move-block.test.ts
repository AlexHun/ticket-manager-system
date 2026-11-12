import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { partialCheckout } from "@ticket/repo-scan/checkout";
import { BOM } from "./line-endings";
import { moveBlock } from "./move-block";
import { REPO_ROOT } from "./test/run-hook";

describe("moveBlock", () => {
  test("appends a range between two LF files", () => {
    expect(moveBlock("a\nb\nc\nd\n", "x\n", { start: 2, end: 3 })).toEqual({
      source: "a\nd\n",
      target: "x\nb\nc\n",
    });
  });

  test("appends a range between two CRLF files", () => {
    expect(
      moveBlock("a\r\nb\r\nc\r\nd\r\n", "x\r\n", { start: 2, end: 3 }),
    ).toEqual({ source: "a\r\nd\r\n", target: "x\r\nb\r\nc\r\n" });
  });

  test("the moved lines take the target's line endings", () => {
    expect(moveBlock("a\r\nb\r\n", "x\ny\n", { start: 1, end: 1 })).toEqual({
      source: "b\r\n",
      target: "x\ny\na\n",
    });
    expect(moveBlock("a\nb\n", "x\r\n", { start: 2, end: 2 })).toEqual({
      source: "a\n",
      target: "x\r\nb\r\n",
    });
  });

  test("an empty target takes the source's line endings", () => {
    expect(moveBlock("a\r\nb\r\n", "", { start: 1, end: 2 })).toEqual({
      source: "",
      target: "a\r\nb\r\n",
    });
  });

  test("--at inserts the range before that line", () => {
    expect(
      moveBlock("a\nb\nc\n", "x\ny\nz\n", { start: 2, end: 3, at: 2 }),
    ).toEqual({ source: "a\n", target: "x\nb\nc\ny\nz\n" });
  });

  test("--at one past the last line appends", () => {
    expect(moveBlock("a\n", "x\n", { start: 1, end: 1, at: 2 }).target).toBe(
      "x\na\n",
    );
  });

  test("a last line with no newline gains one when it is moved or appended to", () => {
    expect(moveBlock("a\nb", "x", { start: 2, end: 2 })).toEqual({
      source: "a\n",
      target: "x\nb\n",
    });
  });

  test("lines outside the range keep their own endings, mixed or not", () => {
    expect(moveBlock("a\r\nb\nc\r\n", "x\n", { start: 2, end: 2 }).source).toBe(
      "a\r\nc\r\n",
    );
  });

  test("a leading byte order mark is dropped from both files", () => {
    expect(
      moveBlock(`${BOM}a\nb\n`, `${BOM}x\n`, { start: 1, end: 1 }),
    ).toEqual({ source: "b\n", target: "x\na\n" });
  });

  test.each([
    [{ start: 0, end: 1 }, "move-block: range 0-1 is outside lines 1-3"],
    [{ start: 2, end: 4 }, "move-block: range 2-4 is outside lines 1-3"],
    [{ start: 3, end: 2 }, "move-block: range 3-2 ends before it starts"],
    [{ start: 1.5, end: 2 }, "move-block: range 1.5-2 is not whole lines"],
    [{ start: 1, end: 1, at: 0 }, "move-block: --at 0 is outside lines 1-2"],
    [{ start: 1, end: 1, at: 3 }, "move-block: --at 3 is outside lines 1-2"],
  ])("refuses %p", (range, message) => {
    expect(() => moveBlock("a\nb\nc\n", "x\n", range)).toThrow(message);
  });
});

// The script is under `scripts/`, which the develop image does not carry.
describe.skipIf(partialCheckout)("bun scripts/move-block.ts", () => {
  const SCRIPT = path.join(REPO_ROOT, "scripts/move-block.ts");
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "move-block-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const run = (...args: string[]) => {
    const result = Bun.spawnSync(["bun", SCRIPT, ...args]);
    return { code: result.exitCode, stderr: result.stderr.toString() };
  };
  const writeFixture = (name: string, content: string) => {
    const file = path.join(dir, name);
    writeFileSync(file, content);
    return file;
  };

  test("moves a range, writing both files as UTF-8 with no BOM", () => {
    const from = writeFixture("from.ts", "// a — b\r\nconst x = 1;\r\n");
    const to = writeFixture("to.ts", "// to\r\n");
    expect(run(from, "2-2", to).code).toBe(0);
    expect(readFileSync(from, "utf8")).toBe("// a — b\r\n");
    const bytes = readFileSync(to);
    expect([...bytes.subarray(0, 3)]).toEqual([0x2f, 0x2f, 0x20]);
    expect(bytes.toString("utf8")).toBe("// to\r\nconst x = 1;\r\n");
  });

  test("--at inserts before that line of the target", () => {
    const from = writeFixture("from.ts", "b\n");
    const to = writeFixture("to.ts", "a\nc\n");
    expect(run(from, "1-1", to, "--at", "2").code).toBe(0);
    expect(readFileSync(to, "utf8")).toBe("a\nb\nc\n");
  });

  test("creates a target that does not exist yet", () => {
    const from = writeFixture("from.ts", "a\nb\n");
    const to = path.join(dir, "new.ts");
    expect(run(from, "2-2", to).code).toBe(0);
    expect(readFileSync(to, "utf8")).toBe("b\n");
    expect(readFileSync(from, "utf8")).toBe("a\n");
  });

  test.each([
    ["0-1", "move-block: range 0-1 is outside lines 1-2"],
    ["2-9", "move-block: range 2-9 is outside lines 1-2"],
    ["2-1", "move-block: range 2-1 ends before it starts"],
    ["1", "move-block: range 1 is not <start>-<end>"],
  ])("writes nothing and exits 1 on range %s", (range, message) => {
    const from = writeFixture("from.ts", "a\nb\n");
    const to = writeFixture("to.ts", "x\n");
    const { code, stderr } = run(from, range, to);
    expect(code).toBe(1);
    expect(stderr.trim()).toBe(message);
    expect(readFileSync(from, "utf8")).toBe("a\nb\n");
    expect(readFileSync(to, "utf8")).toBe("x\n");
  });

  test("a range that fails creates no target", () => {
    const from = writeFixture("from.ts", "a\n");
    const to = path.join(dir, "new.ts");
    expect(run(from, "2-2", to).code).toBe(1);
    expect(existsSync(from)).toBe(true);
    expect(existsSync(to)).toBe(false);
  });

  test("refuses an argument it does not know", () => {
    const from = writeFixture("from.ts", "a\n");
    const to = writeFixture("to.ts", "x\n");
    const { code, stderr } = run(from, "1-1", to, "extra");
    expect(code).toBe(1);
    expect(stderr).toContain("Usage: bun scripts/move-block.ts");
    expect(readFileSync(from, "utf8")).toBe("a\n");
    expect(readFileSync(to, "utf8")).toBe("x\n");
  });

  test("puts the target back when the source cannot be written", () => {
    const from = writeFixture("from.ts", "a\nb\n");
    const to = writeFixture("to.ts", "x\n");
    const created = path.join(dir, "new.ts");
    chmodSync(from, 0o444);
    try {
      const existing = run(from, "2-2", to);
      expect(existing.code).toBe(1);
      expect(existing.stderr).toContain(
        `move-block: ${from} could not be written, so ${to} was put back`,
      );
      expect(readFileSync(to, "utf8")).toBe("x\n");
      expect(run(from, "2-2", created).code).toBe(1);
      expect(existsSync(created)).toBe(false);
      expect(readFileSync(from, "utf8")).toBe("a\nb\n");
    } finally {
      chmodSync(from, 0o644);
    }
  });

  test("refuses to move a range within one file", () => {
    const from = writeFixture("from.ts", "a\nb\n");
    const { code, stderr } = run(from, "1-1", from);
    expect(code).toBe(1);
    expect(stderr).toContain("move-block: source and target are one file");
    expect(readFileSync(from, "utf8")).toBe("a\nb\n");
  });
});
