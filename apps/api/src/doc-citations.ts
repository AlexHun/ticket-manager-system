import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "./strip-comments";

/**
 * The citation index and the two resolvers behind `doc-citations.test.ts`:
 * every backticked path (#439) and code symbol (#440) a document names, with
 * its document and line, checked against the files git tracks and against
 * what their source says outside its comments. Which documents are read is
 * `documentsInScope` (#441, #442).
 *
 * **It lives in `apps/api/src`** for the reason `standards-guard.test.ts` does:
 * the API suite is what `.husky/pre-push` runs, and `apps/api/tsconfig.json`
 * includes only `src`. The plan's later `bun run graph` script
 * (`docs/plans/doc-citations.md`, slice 6) is to reach it by relative path,
 * the way `bun run tokens` reaches `apps/web/dev/usage.ts`, so the logic stays
 * here, under a test runner, and nothing in it is test-only.
 *
 * **Paths resolve against tracked files, never the working directory.** A
 * developer's untracked and gitignored files would otherwise make a citation
 * green on their machine and red on CI. The documents themselves are read from
 * disk, and every line split tolerates `\r\n`, so a CRLF Windows checkout and
 * an LF CI one index the same citations at the same lines.
 *
 * Nothing here touches the database or the network; `git ls-files` reads the
 * local index.
 */

/**
 * One backticked citation: where it is, what it says, and the path or symbol
 * it names. One span can name several symbols (`Prisma.TransactionClient`
 * is checked as `TransactionClient`), each its own citation.
 */
export interface Citation {
  /** The document, relative to the repository root. */
  doc: string;
  /** 1-based. */
  line: number;
  /** The citation as written between the backticks. */
  text: string;
  kind: "path" | "symbol";
  /** The path as `TrackedTree.pathOf` normalised it, or the symbol. */
  name: string;
}

/**
 * A citation that deliberately names nothing in the tree, and why. `citation`
 * is the path or symbol it names (`Citation.name`).
 */
export interface Exemption {
  doc: string;
  citation: string;
  reason: string;
}

/**
 * The extensions that make a backticked word a file path. A list rather than
 * "anything after a dot", so `Output.object` and `z.infer` are not files; the
 * cost is that a symbol which happens to end in one (`Prisma.sql`) is read as
 * a path and has to be exempted.
 */
const FILE_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "mts",
  "cts",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "json",
  "jsonc",
  "md",
  "mdx",
  "yml",
  "yaml",
  "toml",
  "prisma",
  "sql",
  "css",
  "html",
  "sh",
  "ps1",
  "png",
  "svg",
  "webp",
]);

/** No whitespace, glob, placeholder or code characters: one word. */
const NOT_ONE_WORD = /[\s*?<>{}[\]()|$'",;=]/;

const hasFileExtension = (path: string): boolean => {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  // `.env` alone has no name before its dot: a dotfile, not an extension.
  return dot > 0 && FILE_EXTENSIONS.has(base.slice(dot + 1));
};

/** Inline code spans per line; a span of N backticks closes on N backticks. */
const CODE_SPAN = /(?<!`)(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g;

/**
 * The tracked tree, and the one place that decides what a citation names and
 * whether it is there.
 *
 * **Two kinds of citation are paths.**
 * - A word whose last segment ends in a known extension: `provider.ts`,
 *   `ai/provider.ts`, `apps/api/src/ai/provider.ts`. It resolves by one rule,
 *   short or full: it equals a tracked path, or is one's tail starting at a
 *   `/`. So all three resolve against `apps/api/src/ai/provider.ts`, and
 *   `rovider.ts` does not. The cost of the short form is that a bare
 *   `provider.ts` stays green while any `provider.ts` is tracked anywhere; a
 *   citation that must survive that cites the full path.
 * - A word with no such extension, **anchored at the root**: its first
 *   segment is a top-level directory of the tracked tree, so `.husky/pre-push`,
 *   `apps/api/Dockerfile` and `apps/web/dev/` are paths, while `try/catch`,
 *   `@ticket/shared` and a module specifier like `../db` are not. It resolves
 *   exactly: a tracked file, a directory holding one, or a numbered document
 *   cited by its number (`docs/adr/0014` for `docs/adr/0014-….md`).
 */
export class TrackedTree {
  private readonly tails = new Set<string>();
  private readonly exact = new Set<string>();
  private readonly directories = new Set<string>();
  private readonly topLevel = new Set<string>();

  constructor(files: readonly string[]) {
    for (const file of files) {
      this.exact.add(file);
      const segments = file.split("/");
      if (segments.length > 1) this.topLevel.add(segments[0]!);
      for (let at = 0; at < segments.length; at += 1) {
        this.tails.add(segments.slice(at).join("/"));
        if (at > 0) this.directories.add(segments.slice(0, at).join("/"));
      }
      // `docs/adr/0014-in-process-postgres.md` answers to `docs/adr/0014`.
      const numbered = /^(.*\/\d+)-[^/]*$/.exec(file)?.[1];
      if (numbered) this.exact.add(numbered);
    }
  }

  /**
   * The path a citation names, or `undefined` when it is not one. A trailing
   * `:42` or `:42-50` line reference and a `#anchor` are dropped, and so are
   * leading `./` and `../` segments, which make a path relative to a document
   * or a module the resolver does not know. A URL, a route (`/api/x.json`) and
   * a home-relative path (`~/.claude`) are not repo files.
   */
  pathOf(text: string): string | undefined {
    if (NOT_ONE_WORD.test(text) || text.includes("://")) return undefined;
    const path = text.replace(/#.*$/, "").replace(/:\d+(?:-\d+)?$/, "");
    if (path.startsWith("/") || path.startsWith("~")) return undefined;
    const relative = path.replace(/^(?:\.\.?\/)+/, "");
    if (hasFileExtension(relative)) return relative;
    const slash = path.indexOf("/");
    if (slash > 0 && this.topLevel.has(path.slice(0, slash))) {
      return path.replace(/\/$/, "");
    }
    return undefined;
  }

  resolves(path: string): boolean {
    return hasFileExtension(path)
      ? this.tails.has(path)
      : this.exact.has(path) || this.directories.has(path);
  }

  /**
   * Every backticked citation in a markdown document that names a path or a
   * symbol (`symbolsOf`), outside fenced code blocks. A fence holds code, not
   * citations: its imports and examples are read by whoever runs them, not
   * resolved here.
   */
  citationsIn(doc: string, markdown: string): Citation[] {
    const citations: Citation[] = [];
    let fence: string | undefined;
    markdown.split(/\r?\n/).forEach((line, index) => {
      const opener = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
      if (fence) {
        if (opener?.[0] === fence[0] && opener.length >= fence.length) {
          fence = undefined;
        }
        return;
      }
      if (opener) {
        fence = opener;
        return;
      }
      for (const match of line.matchAll(CODE_SPAN)) {
        const text = match[2]!.trim();
        const lineNumber = index + 1;
        const path = this.pathOf(text);
        if (path !== undefined) {
          citations.push({
            doc,
            line: lineNumber,
            text,
            kind: "path",
            name: path,
          });
          continue;
        }
        for (const name of symbolsOf(text)) {
          citations.push({ doc, line: lineNumber, text, kind: "symbol", name });
        }
      }
    });
    return citations;
  }
}

/** The files git tracks under `root`, as `/`-separated paths relative to it. */
export function trackedFiles(root: string): string[] {
  return execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter(Boolean);
}

/* ── Which documents are read ─────────────────────────────────────────────── */

/** The skill directory a tracked file sits in, or `undefined`. */
const skillOf = (file: string): string | undefined =>
  /^\.claude\/skills\/([^/]+)\//.exec(file)?.[1];

/**
 * Whether a PRD's header says its feature has shipped: a `Status: Shipped`
 * line, bold or not, above the first `##` heading, with nothing after the word
 * but the end of the line or a `·` and the next field. Anything else, a missing
 * line included, is open, so a status written wrongly keeps the PRD checked
 * rather than freezing it.
 */
function isShipped(markdown: string): boolean {
  const header = markdown.split(/^##\s/m)[0]!;
  return /^(?:\*\*Status:\*\*|Status:)[ \t]*Shipped[ \t]*(?:·|\r?$)/m.test(
    header,
  );
}

/**
 * The markdown documents the check reads, out of the tracked files: the
 * standards, the ADRs, every `CLAUDE.md`, everything under `.claude/skills/`
 * and `.claude/agents/` (#441), which are what an agent reads before it reads
 * the code, and every PRD under `docs/prd/` whose feature is still open
 * (#442). `read` returns a document's text, and is asked only for PRDs.
 *
 * **Skills are in scope unless excluded by name**, so a skill added later is
 * checked from its first commit. `excludedSkills` names directories under
 * `.claude/skills/` whose documents describe a library's API rather than this
 * repo; every name in it must still be a directory, which `unknownExclusions`
 * checks. `.agents/` is never read: it holds the vendored copies
 * `skills-lock.json` pins by hash, which a citation fix would break.
 *
 * **A PRD is read until its header says `Status: Shipped`** (`isShipped`),
 * which the `implement` skill writes in the PR that closes its last ticket.
 * After that it is history, and history names what has since been renamed.
 * **Plans under `docs/plans/` are never read**: a plan names the `new:`
 * modules it proposes, so every plan would fail the day it was written, and
 * checking only the citations that once resolved would need the git history
 * CI's shallow checkout does not fetch. The plan's `bun run graph` query
 * (#444) is to cover them instead.
 */
export function documentsInScope(
  files: readonly string[],
  excludedSkills: readonly string[],
  read: (doc: string) => string,
): string[] {
  const excluded = new Set(excludedSkills);
  return files.filter((file) => {
    if (!file.endsWith(".md") || file.startsWith(".agents/")) return false;
    const skill = skillOf(file);
    if (skill !== undefined) return !excluded.has(skill);
    if (file.startsWith("docs/prd/")) return !isShipped(read(file));
    return (
      file.startsWith("docs/standards/") ||
      file.startsWith("docs/adr/") ||
      file.startsWith(".claude/agents/") ||
      file === "CLAUDE.md" ||
      file.endsWith("/CLAUDE.md")
    );
  });
}

/**
 * The excluded skills that name no tracked directory under `.claude/skills/`:
 * a skill renamed or removed leaves its exclusion excusing nothing, and a
 * misspelt one excuses nothing from the start.
 */
export function unknownExclusions(
  files: readonly string[],
  excludedSkills: readonly string[],
): string[] {
  const skills = new Set(files.map(skillOf));
  return excludedSkills.filter((skill) => !skills.has(skill));
}

/* ── Symbols ──────────────────────────────────────────────────────────────── */

/** One identifier, optionally dotted and optionally called: `a.b.c()`. */
const IDENTIFIER_CHAIN = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\(\))?$/;

/**
 * A word shaped like a name in code rather than in prose: camelCase or a
 * PascalCase compound (`useTheme`, `TableFrame`), an underscore inside it
 * (`TABLE_FRAME`, `tool_use`), or a leading `$` or `_` (`$transaction`).
 *
 * A plain word is not checked, and that is measured rather than cautious:
 * over the standards and ADRs, checking every identifier in backticks instead
 * of these added 11 misses, and only one named this code at all: ADR-0019's
 * `RETRYABLE`, its shorthand for `RETRYABLE_AI_FAILURE`. The other ten were
 * SQL (`CONCURRENTLY`, `NOTIFY`), mail and HTTP headers (`References`,
 * `Cookie`), an error code (`P2002`), a shell command (`curl`), a commit type
 * (`refactor`) and English used as a model's or type's name in an ADR's
 * argument (`Notification`, `Outcome`, `Stage`). The cost is that a renamed
 * one-word name (`Prisma`, `Toggle`) is not caught.
 */
const CODE_SHAPED = /[a-z0-9][A-Z]|\w_\w|^[$_]/;

/**
 * The symbols a backticked span names, or none. The span must be one
 * identifier chain that is not a path; each code-shaped segment is a symbol,
 * so `ROUTE.users.timingKey` names `timingKey` and
 * `Prisma.TransactionClient` names `TransactionClient`. A call with
 * arguments, a generic, an assignment or a sentence names none: only a bare
 * name is a citation, as a bare path is.
 */
function symbolsOf(text: string): string[] {
  if (!IDENTIFIER_CHAIN.test(text)) return [];
  return text
    .replace(/\(\)$/, "")
    .split(".")
    .filter((segment) => CODE_SHAPED.test(segment));
}

const NOT_SOURCE = new Set([
  "packages/shared/src/changelog-entries.json",
  "apps/api/src/doc-citations.ts",
  "apps/api/src/doc-citations.test.ts",
]);

/**
 * Which tracked files a symbol may resolve in: the repo's own source, tests
 * and config. Not prose (a document cannot vouch for itself or for another),
 * not binaries or data, not the vendored skills under `.agents/` and the
 * skill and agent documents under `.claude/`, and not
 * `changelog-entries.json`, which is commit subjects: a past subject naming a
 * symbol would keep it alive after the code lost it.
 *
 * **Nor this check's own two files.** The test's exemption table and planted
 * cases spell every exempted and every planted stale name as a string, so
 * read as source they would resolve all of them, and the check would pass
 * over the very names it exists to catch.
 */
export function isSymbolSource(file: string): boolean {
  if (/^(?:\.agents|\.claude\/skills|\.claude\/agents)\//.test(file)) {
    return false;
  }
  if (NOT_SOURCE.has(file)) return false;
  return !/\.(?:md|mdx|txt|jsonl|lock|png|svg|webp|jpe?g|gif|ico)$/i.test(file);
}

/** The files `stripComments` reads: JS, TS and JSON. */
const SLASH_COMMENTED = /\.(?:[cm]?[jt]sx?|json|jsonc)$/;

/**
 * A file's text with its comments blanked, so a word that survives only in a
 * comment is not found. JS, TS and JSON go through `stripComments`, which
 * knows strings and regex literals; CSS loses its block comments (it has no
 * line comments, and a `//` in an unquoted `url()` is not one), SQL loses
 * `--` to the end of the line, `schema.prisma` loses `//`, and everything
 * else (YAML, TOML, shell, Dockerfiles, the Caddyfile, `.husky/*`, ignore
 * files) loses lines that start with `#`. A `#` after code on the same line
 * is kept, since in a Caddyfile or a YAML string it is as often code as
 * comment.
 */
function codeOutsideComments(file: string, text: string): string {
  if (SLASH_COMMENTED.test(file)) return stripComments(text);
  if (file.endsWith(".css")) return text.replace(/\/\*[\s\S]*?\*\//g, "");
  if (file.endsWith(".sql")) return text.replace(/--.*$/gm, "");
  if (file.endsWith(".prisma")) return text.replace(/\/\/.*$/gm, "");
  return text.replace(/^\s*#.*$/gm, "");
}

/** What `SymbolIndex` reads: a tracked file and its text. */
export interface SymbolSource {
  file: string;
  text: string;
}

/**
 * Every word the repo's source, tests and config say outside a comment, and
 * the one place that decides whether a cited symbol is still there.
 *
 * **The rule: a symbol resolves when it is a whole word somewhere in
 * comment-stripped tracked source, tests or config** (`isSymbolSource`,
 * `codeOutsideComments`). Chosen by measurement (#440, the plan's second
 * spike), not assumed. On 2026-10-08 the 33 standards and ADRs cited 593
 * distinct code-shaped symbols, 1,263 times, against 564 source files, and
 * each candidate rule left:
 * - **raw source: 18 misses.** Too loose. 17 more symbols resolved only
 *   because a comment still named them: 3 were names the code had dropped
 *   (`hasInbound`, `UNSTARTED_RANK`, `mockGet`), which the docs cite as
 *   history and raw source would have kept passing after any rename, and 14
 *   were library or tool names a comment happened to mention.
 * - **comment-stripped source: 35 misses, every one real.** Each is absent
 *   from the code: the two stale names `docs/prd/doc-citations.md`'s R9 fixes, history, and library or tool
 *   names the code relies on without spelling (Better Auth's
 *   `requireEmailVerification`, Claude Code's `WebFetch`). The test's
 *   exemptions are that list, minus the two fixes.
 * - **declared names only: 44 misses.** Too strict: the 9 beyond the
 *   comment-stripped 35 are names this code uses and never declares
 *   (`tabIndex`, `dangerouslySetInnerHTML`, `TransactionClient`, `pg_tables`,
 *   environment variables the code reads), each a false failure.
 *
 * A word is `[A-Za-z_$][\w$]*`, and a leading `$` is also indexed without it,
 * so the Caddyfile's `{$API_UPSTREAM}` names `API_UPSTREAM` while
 * `prisma.$transaction` still names `$transaction`. A string's contents
 * count: `"hashFiles"` in a config is a use, not a comment.
 */
export class SymbolIndex {
  private readonly words = new Set<string>();

  constructor(sources: Iterable<SymbolSource>) {
    for (const { file, text } of sources) {
      for (const word of codeOutsideComments(file, text).match(
        /[A-Za-z_$][\w$]*/g,
      ) ?? []) {
        this.words.add(word);
        if (word.startsWith("$")) this.words.add(word.replace(/^\$+/, ""));
      }
    }
  }

  resolves(symbol: string): boolean {
    return this.words.has(symbol);
  }
}

/** The tracked files under `root` a symbol may resolve in, read from disk. */
export function symbolSources(
  root: string,
  files: readonly string[],
): SymbolSource[] {
  return files.filter(isSymbolSource).map((file) => ({
    file,
    text: readFileSync(join(root, file), "utf8"),
  }));
}

/** What the check found: each line a failing run can be acted on from. */
export interface CitationReport {
  /** `doc:line cites <text or symbol>, which …`. */
  stale: string[];
  /** Exemptions that matched no unresolved citation. */
  unusedExemptions: string[];
}

/**
 * Every citation that resolves to nothing and is not exempted, and every
 * exemption that excused nothing. A path resolves against the tracked tree, a
 * symbol against the symbol index. An exemption names its document and the
 * path or symbol, and covers every line of that document that cites it; one
 * that no longer matches an unresolved citation is reported, so the list
 * cannot rot into a record of things already fixed.
 */
export function checkCitations(
  citations: readonly Citation[],
  tree: TrackedTree,
  symbols: SymbolIndex,
  exemptions: readonly Exemption[],
): CitationReport {
  const used = new Set<Exemption>();
  const stale: string[] = [];
  for (const citation of citations) {
    const resolves =
      citation.kind === "path"
        ? tree.resolves(citation.name)
        : symbols.resolves(citation.name);
    if (resolves) continue;
    const exemption = exemptions.find(
      (e) => e.doc === citation.doc && e.citation === citation.name,
    );
    if (exemption) used.add(exemption);
    else {
      const where = `${citation.doc}:${citation.line}`;
      stale.push(
        citation.kind === "path"
          ? `${where} cites \`${citation.text}\`, which no tracked file matches`
          : `${where} cites \`${citation.name}\`, which no source, test or config file names outside a comment`,
      );
    }
  }
  return {
    stale,
    unusedExemptions: exemptions
      .filter((e) => !used.has(e))
      .map(
        (e) =>
          `${e.doc} exempts \`${e.citation}\`, which no longer fails: remove the exemption`,
      ),
  };
}
