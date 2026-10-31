#!/usr/bin/env bun
// Replaces exact strings in one file, each exactly once, for an edit the Edit
// tool can't make: a bulk edit, or a file not yet read (#629). The shell ways
// fail on this Windows machine: `Set-Content` and `Out-File` write a byte
// order mark and `Get-Content` without `-Encoding utf8` reads UTF-8 as
// Windows-1252 (`docs/standards/checks.md`), and a multi-line `-replace` or
// `sed` missed on a CRLF working tree (#624).
//
// The pairs file is a JSON list of `[from, to]` string pairs. What is done
// with them is `replaceOnce` in `apps/api/src/replace-once.ts`, which the API
// suite tests; this file only reads argv and the two files, and writes the
// result as UTF-8 only when every pair matched exactly once.
//
// `--revert` undoes an edit with the same pairs file, for the temporary revert
// that proves a test can fail. When the edit is to this script or the module
// above, keep a copy instead: a broken revert cannot undo the change that
// broke it.
//
// Usage:
//   bun scripts/replace-once.ts <file> <pairs.json>
//   bun scripts/replace-once.ts --revert <file> <pairs.json>

import { readFileSync, writeFileSync } from "node:fs";
import { isPair, replaceOnce } from "../apps/api/src/replace-once.ts";

const args = process.argv.slice(2);
const revert = args[0] === "--revert";
const [file, pairsFile] = revert ? args.slice(1) : args;
if (!file || !pairsFile) {
  console.error(
    "Usage: bun scripts/replace-once.ts [--revert] <file> <pairs.json>",
  );
  process.exit(1);
}
// `\s` covers a byte order mark, which a pairs file written by PowerShell has.
const pairs: unknown = JSON.parse(
  readFileSync(pairsFile, "utf8").replace(/^\s+/, ""),
);
if (!Array.isArray(pairs) || !pairs.every(isPair)) {
  console.error(
    `replace-once: ${pairsFile} is not a JSON list of [from, to] string pairs`,
  );
  process.exit(1);
}
try {
  writeFileSync(
    file,
    replaceOnce(readFileSync(file, "utf8"), pairs, { revert }),
    "utf8",
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
console.log(`replace-once: ${pairs.length} replaced in ${file}`);
