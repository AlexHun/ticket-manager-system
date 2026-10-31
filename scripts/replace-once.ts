#!/usr/bin/env bun
// Replaces exact strings in one file, each exactly once, for an edit the Edit
// tool can't make: a bulk edit, or a file not yet read (#629). It exists
// because the shell ways to do it fail on this Windows machine
// (`docs/standards/checks.md`): `Set-Content` and `Out-File` write a BOM,
// `Get-Content` without `-Encoding utf8` reads UTF-8 as Windows-1252, and a
// multi-line `-replace` or `sed` misses on a CRLF working tree.
//
// The pairs file is a JSON list of `[from, to]` pairs, applied in order. A
// `\n` in a pair matches CRLF too, and the replacement takes the line endings
// of what it replaced, or of the file when the match held no newline. Each
// `from` must occur exactly once in the text the pairs before it left;
// otherwise it throws, naming every pair that did not, and writes nothing.
// The file is read and written as UTF-8 with no BOM added.
//
// `--revert` applies each pair as `[to, from]`, so the same pairs file undoes
// the edit: the temporary revert that proves a test can fail is two commands.
// Keep a copy of the file anyway when the edit is to this script itself,
// since a broken `--revert` cannot undo the change that broke it.
//
// The API suite tests `replaceOnce` (`apps/api/src/replace-once.test.ts`).
//
// Usage:
//   bun scripts/replace-once.ts <file> <pairs.json>
//   bun scripts/replace-once.ts --revert <file> <pairs.json>

import { readFileSync, writeFileSync } from "node:fs";

export type Pair = [from: string, to: string];

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const NEWLINE = /\r?\n/;

export const replaceOnce = (
  text: string,
  pairs: readonly Pair[],
  { revert = false }: { revert?: boolean } = {},
) => {
  const fileEnding = text.includes("\r\n") ? "\r\n" : "\n";
  const failures: string[] = [];
  let result = text;
  pairs.forEach((pair, index) => {
    const [from, to] = revert ? [pair[1], pair[0]] : pair;
    const label = `replace-once: pair ${index + 1}`;
    if (from === "") {
      failures.push(`${label} has an empty search string`);
      return;
    }
    const pattern = new RegExp(
      from.split(NEWLINE).map(escapeRegExp).join("\\r?\\n"),
      "g",
    );
    const matches = [...result.matchAll(pattern)];
    if (matches.length !== 1) {
      failures.push(
        `${label} (${JSON.stringify(from)}) matches ${matches.length} times`,
      );
      return;
    }
    const [match] = matches;
    const ending = match[0].includes("\r\n")
      ? "\r\n"
      : match[0].includes("\n")
        ? "\n"
        : fileEnding;
    const start = match.index;
    result =
      result.slice(0, start) +
      to.split(NEWLINE).join(ending) +
      result.slice(start + match[0].length);
  });
  if (failures.length > 0) throw new Error(failures.join("\n"));
  return result;
};

const isPair = (value: unknown): value is Pair =>
  Array.isArray(value) &&
  value.length === 2 &&
  typeof value[0] === "string" &&
  typeof value[1] === "string";

if (import.meta.main) {
  const args = process.argv.slice(2);
  const revert = args[0] === "--revert";
  const [file, pairsFile] = revert ? args.slice(1) : args;
  if (!file || !pairsFile) {
    console.error(
      "Usage: bun scripts/replace-once.ts [--revert] <file> <pairs.json>",
    );
    process.exit(1);
  }
  const pairs: unknown = JSON.parse(
    readFileSync(pairsFile, "utf8").replace(/^\uFEFF/, ""),
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
}
