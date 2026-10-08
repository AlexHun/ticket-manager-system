import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "./strip-comments";

/**
 * The citation index and the two resolvers behind `doc-citations.test.ts`:
 * every backticked path (#439) and code symbol (#440) a document names, with
 * its document and line, checked against the files git tracks and against
 * what their source says outside its comments. Which documents are read is
 * `documentsInScope` (#441, #442); what a failure says a stale citation was
 * renamed to is `renameHints` (#443); who cites a file and what a document
 * cites, the query behind `bun run graph`, are `citersOf` and
 * `resolvedCitationsIn` (#444).
 *
 * **It lives in `apps/api/src`** for the reason `standards-guard.test.ts` does:
 * the API suite is what `.husky/pre-push` runs, and `apps/api/tsconfig.json`
 * includes only `src`. `scripts/graph.ts` reaches it by relative path, the way
 * `bun run tokens` reaches `apps/web/dev/usage.ts`, so the logic stays here,
 * under a test runner, and nothing in it is test-only.
 *
 * **Paths resolve against tracked files, never the working directory.** A
 * developer's untracked and gitignored files would otherwise make a citation
 * green on their machine and red on CI. The documents themselves are read from
 * disk, and every line split tolerates `\r\n`, so a CRLF Windows checkout and
 * an LF CI one index the same citations at the same lines.
 *
 * Nothing here touches the database or the network; `git ls-files` reads the
 * local index, and `renameHints` the local history.
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
 * CI's shallow checkout does not fetch. The `bun run graph` query reads them
 * instead (`documentsQueried`, #444), and reports rather than fails.
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
 * Skills under `.claude/skills/` that are not read, each because it describes
 * a library's API rather than this repo: on 2026-10-08 they held 756 of the
 * 795 unresolved citations in every skill and agent, nearly all of them the
 * library's own names. A skill not named here is read, so one added later is
 * checked until someone names it. A name that is no longer a skill directory
 * fails the check (`unknownExclusions`). It lives here rather than beside the
 * exemptions in `doc-citations.test.ts` because `bun run graph` reads the same
 * documents the check does, and a script cannot import a test file.
 */
export const EXCLUDED_SKILLS: readonly string[] = [
  // shadcn/ui's Radix-to-Base-UI migration guide.
  "migrate-radix-to-base",
  // shadcn/ui's CLI, registry and component reference.
  "shadcn",
  // Better Auth's configuration reference.
  "better-auth-best-practices",
];

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

/** Prose, data and binaries: a symbol does not resolve in these. */
const NOT_SOURCE_EXTENSIONS = [
  "md",
  "mdx",
  "txt",
  "jsonl",
  "lock",
  "png",
  "svg",
  "webp",
  "jpg",
  "jpeg",
  "gif",
  "ico",
] as const;

/** The vendored skills, and the skill and agent documents under `.claude/`. */
const NOT_SOURCE_DIRECTORIES = [".agents", ".claude/skills", ".claude/agents"];

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
  if (NOT_SOURCE_DIRECTORIES.some((dir) => file.startsWith(`${dir}/`))) {
    return false;
  }
  if (NOT_SOURCE.has(file)) return false;
  const extension = file.slice(file.lastIndexOf(".") + 1).toLowerCase();
  return !(NOT_SOURCE_EXTENSIONS as readonly string[]).includes(extension);
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

/* ── Renames: what git history says a stale citation became ─────────────── */

/** A citation's new name, and the commit that gave it. */
export interface Rename {
  to: string;
  sha: string;
}

/**
 * The rename behind a stale citation, or `undefined` when history shows none.
 * `checkCitations` asks it only for a citation that has already failed and is
 * not exempted, and writes the answer as `OLD → New (<sha>)`.
 */
export type RenameHint = (citation: Citation) => Rename | undefined;

/**
 * Where a symbol's history is read: the `isSymbolSource` files, as a git
 * pathspec. Without it the last commit to touch a stale name is as often a
 * document or this check's own tables, which spell it as a string. It is
 * built from the lists `isSymbolSource` reads, so the two cannot drift apart.
 */
const SYMBOL_SOURCE_PATHSPEC = [
  ".",
  ...NOT_SOURCE_EXTENSIONS.map((extension) => `:(exclude)*.${extension}`),
  ...NOT_SOURCE_DIRECTORIES.map((directory) => `:(exclude)${directory}`),
  ...[...NOT_SOURCE].map((file) => `:(exclude)${file}`),
];

/**
 * A diff line that is a comment, which says what a name was, not what it is:
 * `//`, `/*`, a JSDoc `*` line, and `#` or `--` followed by a space, so a TS
 * private field (`#client`) and a CLI flag (`--count`) are still code.
 */
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*(?:\s|\/|$)|#(?:\s|$)|--(?:\s|$))/;

/** A line's tokens: names, numbers, quoted strings and single symbols. */
const TOKEN = /[A-Za-z_$][\w$]*|\d[\w.]*|"[^"]*"|'[^']*'|`[^`]*`|\S/g;

const IS_NAME = /^[A-Za-z_$]/;

/**
 * The name `symbol` became in one commit's diff, or `undefined`: a removed
 * line and an added one that are the same token for token, numbers, strings
 * and punctuation included, but for `symbol`, each of whose places holds one
 * other name, and which share at least one name besides it. A real rename
 * changes every call site the same way, so the most frequent such name wins.
 * Comment lines are skipped, so a later edit that only rewords a comment is
 * not the rename.
 */
function renameInDiff(diff: string, symbol: string): string | undefined {
  const removed: string[][] = [];
  const removedTokens: string[] = [];
  const added: string[][] = [];
  for (const line of diff.split(/\r?\n/)) {
    if (/^(?:---|\+\+\+) /.test(line)) continue;
    const sign = line[0];
    if ((sign !== "-" && sign !== "+") || COMMENT_LINE.test(line.slice(1))) {
      continue;
    }
    const tokens: string[] = line.slice(1).match(TOKEN) ?? [];
    if (sign === "-") removedTokens.push(...tokens);
    if (sign === "-" && tokens.includes(symbol)) removed.push(tokens);
    if (sign === "+") added.push(tokens);
  }
  const counts = new Map<string, number>();
  for (const before of removed) {
    // A line that is the name alone (`emptyScan,` in an export list) matches
    // any other lone name, so a pair needs one name besides it in common.
    if (!before.some((token) => token !== symbol && IS_NAME.test(token))) {
      continue;
    }
    for (const after of added) {
      if (after.length !== before.length) continue;
      let to: string | undefined;
      const sameButTheName = before.every((token, at) => {
        if (token !== symbol) return token === after[at];
        to ??= after[at];
        return after[at] === to && to !== symbol && IS_NAME.test(to);
      });
      if (sameButTheName && to) counts.set(to, (counts.get(to) ?? 0) + 1);
    }
  }
  // The new name is new: a name a removed line already held existed before
  // this commit, so it is not what the old one became.
  const existed = new Set(removedTokens);
  return [...counts]
    .filter(([name]) => !existed.has(name))
    .sort((a, b) => b[1] - a[1])[0]?.[0];
}

/**
 * Whether a renamed file's old path is the one a citation names, by the rule
 * `TrackedTree.resolves` uses: a path with an extension whole or as a tail
 * from a `/`, an anchored one exactly. A directory is not followed through
 * the renames of the files in it, since a directory whose files went to
 * different places has no one new name.
 */
function namesPath(cited: string, from: string): boolean {
  return (
    from === cited || (hasFileExtension(cited) && from.endsWith(`/${cited}`))
  );
}

/**
 * The rename lookup for the repository at `root`, against its current `tree`
 * and `symbols`. Nothing runs until a stale citation asks, so a green check
 * reads no history, and a name cited on several lines is looked up once.
 *
 * - **A path** takes each rename whose old side it names (`git log -M
 *   --diff-filter=R`, read once for every path) and follows every later
 *   rename of the new path, so `a → b → c` names `c` and the commit of the
 *   last hop. When the matches lead to different files, as two renamed files
 *   that shared a short citation's name do, there is no hint.
 * - **A symbol** takes the newest commit that changed how often source names
 *   it (`git log -S`) and whose diff shows what it became (`renameInDiff`),
 *   followed up to three renames on. Each symbol is its own pickaxe over the
 *   whole history, ~2s on this repo, paid only on a push that already fails.
 *   It is a heuristic, measured on 2026-10-08 over seven of the names the
 *   test exempts as history: four were named right (`TABLE_FRAME`,
 *   `AutoReplyOutcome`, `renderWithQuery`, `mockGet`), two got no hint, and
 *   one was named wrong: `hasInbound` became `inboundCount`, which lines the
 *   same commit rewrote already held, so the hint named `hasOutbound`, a
 *   field added beside it. A path's hint has no such guess in it.
 *
 * **The hint is absent rather than wrong.** On a shallow clone, which is what
 * CI's API job checks out, history is cut off and nothing is looked up; a
 * name history points to that no longer resolves gives no hint; and a git
 * that fails, or a directory that is not a repository, answers nothing. The
 * citation fails either way. Git runs with `log.showSignature` off, so a
 * developer's signature lines cannot be read as commits.
 */
export function renameHints(
  root: string,
  tree: TrackedTree,
  symbols: SymbolIndex,
): RenameHint {
  const git = (...args: string[]): string | undefined => {
    try {
      return execFileSync(
        "git",
        [
          "-c",
          "core.quotePath=false",
          "-c",
          "log.showSignature=false",
          ...args,
        ],
        {
          cwd: root,
          encoding: "utf8",
          maxBuffer: 64 * 1024 * 1024,
          stdio: ["ignore", "pipe", "ignore"],
        },
      );
    } catch {
      return undefined;
    }
  };

  let history: boolean | undefined;
  const hasHistory = () =>
    (history ??=
      git("rev-parse", "--is-shallow-repository")?.trim() === "false");

  let renames: ({ from: string } & Rename)[] | undefined;
  const pathRenames = () => {
    if (renames) return renames;
    renames = [];
    let sha = "";
    const log = git(
      "log",
      "--reverse",
      "-M",
      "--diff-filter=R",
      "--name-status",
      "--format=commit %h",
    );
    for (const line of (log ?? "").split(/\r?\n/)) {
      const commit = /^commit (\w+)$/.exec(line);
      if (commit) sha = commit[1]!;
      const rename = /^R\d*\t([^\t]+)\t([^\t]+)$/.exec(line);
      if (rename) renames.push({ sha, from: rename[1]!, to: rename[2]! });
    }
    return renames;
  };

  const renamedPath = (cited: string): Rename | undefined => {
    const all = pathRenames();
    const ends = all.flatMap((first, at) => {
      if (!namesPath(cited, first.from)) return [];
      let end: Rename = { to: first.to, sha: first.sha };
      for (const later of all.slice(at + 1)) {
        if (later.from === end.to) end = { to: later.to, sha: later.sha };
      }
      return [end];
    });
    const latest = ends.at(-1);
    if (!latest || ends.some((end) => end.to !== latest.to)) return undefined;
    return tree.resolves(latest.to) ? latest : undefined;
  };

  const renamedSymbol = (symbol: string, hops = 3): Rename | undefined => {
    const shas = git(
      "log",
      `-S${symbol}`,
      "--format=%h",
      "--",
      ...SYMBOL_SOURCE_PATHSPEC,
    );
    for (const sha of (shas ?? "").split(/\r?\n/).filter(Boolean)) {
      const diff = git(
        "show",
        sha,
        "--format=",
        "-U0",
        "--no-color",
        "--",
        ...SYMBOL_SOURCE_PATHSPEC,
      );
      const to = diff && renameInDiff(diff, symbol);
      if (!to) continue;
      if (symbols.resolves(to)) return { to, sha };
      return hops > 1 ? renamedSymbol(to, hops - 1) : undefined;
    }
    return undefined;
  };

  const answers = new Map<string, Rename | undefined>();
  return ({ kind, name }) => {
    if (!hasHistory()) return undefined;
    const key = `${kind}:${name}`;
    if (!answers.has(key)) {
      answers.set(
        key,
        kind === "path" ? renamedPath(name) : renamedSymbol(name),
      );
    }
    return answers.get(key);
  };
}

/** A path against the tracked tree, a symbol against the symbol index. */
function resolvesIn(
  citation: Citation,
  tree: TrackedTree,
  symbols: SymbolIndex,
): boolean {
  return citation.kind === "path"
    ? tree.resolves(citation.name)
    : symbols.resolves(citation.name);
}

/** What the check found: each line a failing run can be acted on from. */
export interface CitationReport {
  /**
   * `doc:line cites <text or symbol>, which …`, ending `; renamed OLD → New
   * (<sha>)` when history shows the rename.
   */
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
 * cannot rot into a record of things already fixed. `hint` (`renameHints`) is
 * asked only about a citation that fails, so a green run reads no history.
 */
export function checkCitations(
  citations: readonly Citation[],
  tree: TrackedTree,
  symbols: SymbolIndex,
  exemptions: readonly Exemption[],
  hint: RenameHint = () => undefined,
): CitationReport {
  const used = new Set<Exemption>();
  const stale: string[] = [];
  for (const citation of citations) {
    if (resolvesIn(citation, tree, symbols)) continue;
    const exemption = exemptions.find(
      (e) => e.doc === citation.doc && e.citation === citation.name,
    );
    if (exemption) used.add(exemption);
    else {
      const where = `${citation.doc}:${citation.line}`;
      // OLD is the citation's name, so a path reads as normalised
      // (`provider.ts`, not `./provider.ts:42`); the failure quotes the text.
      const renamed = hint(citation);
      const renamedNote = renamed
        ? `; renamed ${citation.name} → ${renamed.to} (${renamed.sha})`
        : "";
      stale.push(
        citation.kind === "path"
          ? `${where} cites \`${citation.text}\`, which no tracked file matches${renamedNote}`
          : `${where} cites \`${citation.name}\`, which no source, test or config file names outside a comment${renamedNote}`,
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

/* ── The query behind `bun run graph` (#444) ──────────────────────────────── */

/**
 * The documents `bun run graph` reads: every one the check reads
 * (`documentsInScope`), and every plan under `docs/plans/`. The check leaves
 * plans out because a plan names the `new:` modules it proposes and would
 * fail the day it was written; the query only reports, so a plan's proposed
 * module reads as unresolved rather than failing anything, and a plan that
 * names an existing file is one of the documents that speaks about it.
 * Shipped PRDs stay out: they are history, and history names what has since
 * been renamed.
 */
export function documentsQueried(
  files: readonly string[],
  excludedSkills: readonly string[],
  read: (doc: string) => string,
): string[] {
  const inScope = new Set(documentsInScope(files, excludedSkills, read));
  return files.filter(
    (file) =>
      inScope.has(file) ||
      (file.startsWith("docs/plans/") && file.endsWith(".md")),
  );
}

/**
 * Whether a citation names `file` itself, by the rule `TrackedTree.resolves`
 * uses: a path with an extension whole or as a tail from a `/`, an anchored
 * one exactly or as a numbered document's number (`docs/adr/0014`). A
 * directory that holds the file is not a citation of it: `apps/api/src/`
 * names every file under it and so governs none of them in particular, and
 * counting it would bury the bullets about this file under every one that
 * names its folder. A symbol cites the file when the file declares it.
 */
function citesFile(
  citation: Citation,
  file: string,
  declared: ReadonlySet<string>,
): boolean {
  const { kind, name } = citation;
  if (kind === "symbol") return declared.has(name);
  if (hasFileExtension(name)) return namesPath(name, file);
  return name === file || /^(.*\/\d+)-[^/]*$/.exec(file)?.[1] === name;
}

/**
 * Every citation that names `file`, in the order given: the documents and
 * lines that speak about it. `declared` is what the file exports, which the
 * caller reads off the project map's scan (`ModuleNode.exports` in
 * `apps/web/dev/scan.ts`) rather than this module parsing source a second
 * time. A name the file only uses is not enough, since a common one would
 * make every file that calls it look governed by the bullet about its owner.
 */
export function citersOf(
  file: string,
  citations: readonly Citation[],
  declared: readonly string[] = [],
): Citation[] {
  const names = new Set(declared);
  return citations.filter((citation) => citesFile(citation, file, names));
}

/** A citation and whether the path or symbol it names is still there. */
export interface ResolvedCitation extends Citation {
  resolves: boolean;
}

/**
 * Every path and symbol `markdown` cites, each with whether it resolves, by
 * the rules the check applies. No exemption is consulted: the answer is what
 * the tree says, so a deliberate piece of history reads as unresolved here,
 * as it does before the check excuses it.
 */
export function resolvedCitationsIn(
  doc: string,
  markdown: string,
  tree: TrackedTree,
  symbols: SymbolIndex,
): ResolvedCitation[] {
  return tree.citationsIn(doc, markdown).map((citation) => ({
    ...citation,
    resolves: resolvesIn(citation, tree, symbols),
  }));
}
