#!/usr/bin/env bun
// Which documents speak about a file, and what a document speaks about (#444,
// `docs/plans/doc-citations.md` slice 6).
//
// Given a repo file, it prints every document and line that cites it, then
// the file's importers and imports. Given a markdown document, it also prints
// every path and symbol the document cites and whether each still resolves.
// `--mermaid` prints the file's one-hop neighbourhood as a fenced `mermaid`
// block instead, which GitHub renders when pasted into a PR or an issue.
//
// It joins two things that already exist and builds neither:
//   - the citation index, `apps/api/src/doc-citations.ts`, which the API suite
//     tests, `citersOf` and `resolvedCitationsIn` included;
//   - the module graph `scanProject` in `apps/web/dev/scan.ts` builds for
//     `/__dev/map`, whose `imports`, `importedBy` and `exports` are read here.
// So this file only decides argv and layout, the split `bun run tokens` keeps
// with `gatherUsage`, and for the same reason: `scripts/` has no test runner
// (`docs/standards/frontend.md`). Change what it prints and check it by hand.
//
// Run by Bun, like every script here: both modules it reaches are TypeScript.
//
// Usage:
//   bun run graph apps/api/src/ai/provider.ts
//   bun run graph docs/standards/ai-features.md
//   bun run graph apps/api/src/ai/provider.ts --mermaid

import path from "node:path";
import { readFileSync } from "node:fs";
import {
  type Citation,
  citersOf,
  documentsQueried,
  EXCLUDED_SKILLS,
  type ResolvedCitation,
  resolvedCitationsIn,
  SymbolIndex,
  symbolSources,
  TrackedTree,
  trackedFiles,
} from "../apps/api/src/doc-citations.ts";
import { scanProject } from "../apps/web/dev/scan.ts";

const ROOT = path.resolve(import.meta.dir, "..");

/**
 * A repo-relative, `/`-separated path, whether the argument was typed relative
 * to the root, absolute, or with Windows separators. `bun run` starts scripts
 * at the root whatever directory it was typed in, so relative means the root.
 */
const repoPath = (arg: string) =>
  path.relative(ROOT, path.resolve(ROOT, arg)).split(path.sep).join("/");

const lineOf = (c: Citation) => `${c.doc}:${c.line}`;

/** Citations grouped by document, in first-seen order, with their lines. */
function byDoc(citations: readonly Citation[]): Map<string, number[]> {
  const docs = new Map<string, number[]>();
  for (const c of citations) {
    const lines = docs.get(c.doc) ?? [];
    if (!lines.includes(c.line)) lines.push(c.line);
    docs.set(c.doc, lines);
  }
  return docs;
}

/**
 * A titled list. A row repeated is printed once: a name cited three times on
 * one line is one place to read, not three.
 */
function section(title: string, rows: readonly string[]) {
  const unique = [...new Set(rows)];
  console.log(`\n${title} (${unique.length}):`);
  if (!unique.length) console.log("  none");
  for (const row of unique) console.log(`  ${row}`);
}

/** A Mermaid label, quoted, with the one character that would end it escaped. */
const label = (text: string) => `"${text.replace(/"/g, "#quot;")}"`;

function mermaid(
  file: string,
  citers: readonly Citation[],
  importedBy: readonly string[],
  imports: readonly string[],
  cites: readonly ResolvedCitation[],
): string {
  const lines = ["```mermaid", "flowchart LR", `  target[${label(file)}]`];
  let next = 0;
  const node = (text: string) => `n${next++}[${label(text)}]`;
  for (const [doc, at] of byDoc(citers)) {
    // An edge label past a handful of lines is a wall of numbers; the text
    // output has every line.
    const where =
      at.length <= 5 ? `cites :${at.join(", :")}` : `cites ${at.length} lines`;
    lines.push(`  ${node(doc)} -. ${label(where)} .-> target`);
  }
  for (const from of importedBy) lines.push(`  ${node(from)} --> target`);
  for (const to of imports) lines.push(`  target --> ${node(to)}`);
  const missing: string[] = [];
  const named = new Set<string>();
  for (const c of cites) {
    if (named.has(c.name)) continue;
    named.add(c.name);
    const id = `n${next}`;
    lines.push(`  target -. cites .-> ${node(c.name)}`);
    if (!c.resolves) missing.push(id);
  }
  lines.push("  style target stroke-width:3px");
  if (missing.length) {
    lines.push("  classDef missing stroke-dasharray:4 3,stroke:#d33");
    lines.push(`  class ${missing.join(",")} missing`);
  }
  lines.push("```");
  return lines.join("\n");
}

function main() {
  const argv = process.argv.slice(2);
  const asMermaid = argv.includes("--mermaid");
  const targets = argv.filter((a) => !a.startsWith("--"));
  if (targets.length !== 1) {
    console.error("Usage: bun run graph <file|doc> [--mermaid]");
    process.exitCode = 1;
    return;
  }

  const file = repoPath(targets[0]!);
  const files = trackedFiles(ROOT);
  if (!files.includes(file)) {
    console.error(
      `${file} is not a file git tracks. A relative path is read from the repo root.`,
    );
    process.exitCode = 1;
    return;
  }

  const read = (doc: string) => readFileSync(path.join(ROOT, doc), "utf8");
  const tree = new TrackedTree(files);
  const module = scanProject(ROOT).modules.find((m) => m.id === file);
  const citations = documentsQueried(files, EXCLUDED_SKILLS, read).flatMap(
    (doc) => tree.citationsIn(doc, read(doc)),
  );
  const citers = citersOf(file, citations, module?.exports ?? []);
  const importedBy = module?.importedBy ?? [];
  const imports = module?.imports ?? [];

  // A document's own citations need the symbol index, ~0.5s over the repo's
  // source, so only a markdown target pays for it.
  const cites = file.endsWith(".md")
    ? resolvedCitationsIn(
        file,
        read(file),
        tree,
        new SymbolIndex(symbolSources(ROOT, files)),
      )
    : [];

  if (asMermaid) {
    console.log(mermaid(file, citers, importedBy, imports, cites));
    return;
  }

  console.log(file);
  section(
    "Cited by",
    citers.map((c) => `${lineOf(c)}  \`${c.text}\``),
  );
  if (module) {
    section("Imported by", importedBy);
    section("Imports", imports);
  } else if (!file.endsWith(".md")) {
    console.log(
      "\nNot a module in the project map's scan (`apps/web/dev/scan.ts`), so no imports to show.",
    );
  }
  if (file.endsWith(".md")) {
    // Counted the way `section` prints them: once per line and name.
    const missing = new Set(
      cites.filter((c) => !c.resolves).map((c) => `${c.line}:${c.name}`),
    ).size;
    section(
      `Cites, ${missing} not resolving`,
      cites.map(
        (c) =>
          `:${c.line}  ${c.kind.padEnd(6)}  ${c.name}${c.resolves ? "" : "  (does not resolve)"}`,
      ),
    );
  }
}

main();
