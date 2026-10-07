import { execFileSync } from "node:child_process";

/**
 * The citation index and the path resolver behind `doc-citations.test.ts`
 * (#439): every backticked path a document names, with its document and line,
 * checked against the files git tracks.
 *
 * **It lives in `apps/api/src`** for the reason `standards-guard.test.ts` does:
 * the API suite is what `.husky/pre-push` runs, and `apps/api/tsconfig.json`
 * includes only `src`. The planned `bun run graph` script reaches it by
 * relative path, the way `bun run tokens` reaches `apps/web/dev/usage.ts`, so
 * the logic stays here, under a test runner, and nothing in it is test-only.
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

/** One backticked citation: where it is, and what it says. */
export interface Citation {
  /** The document, relative to the repository root. */
  doc: string;
  /** 1-based. */
  line: number;
  /** The citation as written between the backticks. */
  text: string;
}

/** A citation that is deliberately not a tracked file, and why. */
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

/**
 * The path a citation names, or `undefined` when it is not a file path.
 *
 * A path is one word — no whitespace, no glob or placeholder characters, not a
 * URL or a route — whose last segment ends in a known extension. A trailing
 * `:42` or `:42-50` line reference and a `#anchor` are dropped, and so are
 * leading `./` and `../` segments, which make a path relative to a document or
 * a module the resolver does not know.
 */
export function pathOf(text: string): string | undefined {
  let path = text.trim();
  if (/[\s*?<>{}[\]()|$'",;=]/.test(path) || path.includes("://")) {
    return undefined;
  }
  path = path.replace(/#.*$/, "").replace(/:\d+(?:-\d+)?$/, "");
  // A route (`/api/tickets.json`) or a home-relative path is not a repo file.
  if (path.startsWith("/") || path.startsWith("~")) return undefined;
  path = path.replace(/^(?:\.\.?\/)+/, "");
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  // `.env` alone has no name before its dot: a dotfile, not an extension.
  if (dot <= 0) return undefined;
  return FILE_EXTENSIONS.has(base.slice(dot + 1)) ? path : undefined;
}

/** Inline code spans per line; a span of N backticks closes on N backticks. */
const CODE_SPAN = /(?<!`)(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g;

/**
 * Every backticked citation in a markdown document that names a file path,
 * outside fenced code blocks. A fence holds code, not citations: its imports
 * and examples are read by whoever runs them, not resolved here.
 */
export function citationsIn(doc: string, markdown: string): Citation[] {
  const citations: Citation[] = [];
  let fence: string | undefined;
  markdown.split(/\r?\n/).forEach((text, index) => {
    const opener = /^\s*(`{3,}|~{3,})/.exec(text)?.[1];
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
    for (const match of text.matchAll(CODE_SPAN)) {
      const span = match[2]!.trim();
      if (pathOf(span) !== undefined) {
        citations.push({ doc, line: index + 1, text: span });
      }
    }
  });
  return citations;
}

/**
 * Answers whether a cited path names a tracked file, by one rule for short and
 * full citations alike: the citation must equal a tracked path, or be one's
 * tail starting at a `/`. So `provider.ts` and `ai/provider.ts` both resolve
 * against `apps/api/src/ai/provider.ts`, and `rovider.ts` does not.
 */
export class TrackedTree {
  private readonly tails = new Set<string>();

  constructor(readonly files: readonly string[]) {
    for (const file of files) {
      const segments = file.split("/");
      for (let at = 0; at < segments.length; at += 1) {
        this.tails.add(segments.slice(at).join("/"));
      }
    }
  }

  resolves(path: string): boolean {
    return this.tails.has(path);
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

/** What the check found: each line a failing run can be acted on from. */
export interface CitationReport {
  /** `doc:line cites path, which no tracked file matches`. */
  stale: string[];
  /** Exemptions that matched no unresolved citation. */
  unusedExemptions: string[];
}

/**
 * Every citation that resolves to no tracked file and is not exempted, and
 * every exemption that excused nothing. An exemption names its document and
 * the citation as written, and covers every line of that document that cites
 * it; one that no longer matches an unresolved citation is reported, so the
 * list cannot rot into a record of things already fixed.
 */
export function checkCitations(
  citations: readonly Citation[],
  tree: TrackedTree,
  exemptions: readonly Exemption[],
): CitationReport {
  const used = new Set<Exemption>();
  const stale: string[] = [];
  for (const citation of citations) {
    if (tree.resolves(pathOf(citation.text)!)) continue;
    const exemption = exemptions.find(
      (e) => e.doc === citation.doc && e.citation === citation.text,
    );
    if (exemption) used.add(exemption);
    else {
      stale.push(
        `${citation.doc}:${citation.line} cites \`${citation.text}\`, which no tracked file matches`,
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
