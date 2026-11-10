#!/usr/bin/env bun
// Moves a line range from one file into another, so code changes files
// without an agent retyping it in a Write (#758): #748's Write of a new module
// cost about 10k output tokens, two-thirds of it lines moved word for word.
//
// What is done to the two texts is `moveBlock` in `apps/api/src/move-block.ts`,
// which the API suite tests; this file only reads argv and the two files, and
// writes both as UTF-8 only when the range and `--at` fit. A target that does
// not exist yet is created. Source and target must be different files.
//
// Usage:
//   bun scripts/move-block.ts <from> <start>-<end> <to> [--at <line>]

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { moveBlock } from "../apps/api/src/move-block.ts";

const USAGE =
  "Usage: bun scripts/move-block.ts <from> <start>-<end> <to> [--at <line>]";

const args = process.argv.slice(2);
const atIndex = args.indexOf("--at");
const at = atIndex === -1 ? undefined : Number(args[atIndex + 1]);
const [from, rangeArg, to] = atIndex === -1 ? args : args.toSpliced(atIndex, 2);
const range = /^(\d+)-(\d+)$/.exec(rangeArg ?? "");
if (!from || !to || (atIndex !== -1 && args[atIndex + 1] === undefined)) {
  console.error(USAGE);
  process.exit(1);
}
if (!range) {
  console.error(`move-block: range ${rangeArg} is not <start>-<end>`);
  process.exit(1);
}
if (path.resolve(from) === path.resolve(to)) {
  console.error("move-block: source and target are one file");
  process.exit(1);
}
const start = Number(range[1]);
const end = Number(range[2]);
try {
  const moved = moveBlock(
    readFileSync(from, "utf8"),
    existsSync(to) ? readFileSync(to, "utf8") : "",
    { start, end, at },
  );
  writeFileSync(to, moved.target, "utf8");
  writeFileSync(from, moved.source, "utf8");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
console.log(`move-block: moved lines ${start}-${end} of ${from} to ${to}`);
