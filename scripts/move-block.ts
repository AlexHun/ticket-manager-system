#!/usr/bin/env bun
// Moves a line range from one file into another, so code changes files
// without an agent retyping it in a Write (#758). In #748, retro'd 2026-11-08,
// the Write of a new module cost 9.7k output tokens, and about two-thirds of
// that file was moved word for word.
//
// What is done to the two texts is `moveBlock` in `apps/api/src/move-block.ts`,
// which the API suite tests; this file only reads argv and the two files, and
// writes both as UTF-8 only when the range and `--at` fit. A target that does
// not exist yet is created. Source and target must be different files. When
// the source cannot be written after the target was, the target is put back
// as it was, so a failure never leaves the block in both files.
//
// Usage:
//   bun scripts/move-block.ts <from> <start>-<end> <to> [--at <line>]

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { moveBlock } from "../apps/api/src/move-block.ts";

const USAGE =
  "Usage: bun scripts/move-block.ts <from> <start>-<end> <to> [--at <line>]";

// A declaration, not an arrow, so the type checker narrows past each call.
function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const args = process.argv.slice(2);
const atIndex = args.indexOf("--at");
const at = atIndex === -1 ? undefined : Number(args[atIndex + 1]);
const positional = atIndex === -1 ? args : args.toSpliced(atIndex, 2);
const [from, rangeArg, to] = positional;
if (
  !from ||
  !rangeArg ||
  !to ||
  positional.length !== 3 ||
  (atIndex !== -1 && args[atIndex + 1] === undefined)
) {
  fail(USAGE);
}
const range =
  /^(\d+)-(\d+)$/.exec(rangeArg) ??
  fail(`move-block: range ${rangeArg} is not <start>-<end>`);
if (path.resolve(from) === path.resolve(to)) {
  fail("move-block: source and target are one file");
}
const start = Number(range[1]);
const end = Number(range[2]);
const targetBefore = existsSync(to) ? readFileSync(to, "utf8") : undefined;
const move = () => {
  try {
    return moveBlock(readFileSync(from, "utf8"), targetBefore ?? "", {
      start,
      end,
      at,
    });
  } catch (error) {
    return fail(messageOf(error));
  }
};
const moved = move();
try {
  writeFileSync(to, moved.target, "utf8");
} catch (error) {
  fail(messageOf(error));
}
try {
  writeFileSync(from, moved.source, "utf8");
} catch (error) {
  if (targetBefore === undefined) rmSync(to, { force: true });
  else writeFileSync(to, targetBefore, "utf8");
  fail(
    `move-block: ${from} could not be written, so ${to} was put back: ${messageOf(error)}`,
  );
}
console.log(`move-block: moved lines ${start}-${end} of ${from} to ${to}`);
