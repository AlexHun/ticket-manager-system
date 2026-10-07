import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  checkCitations,
  citationsIn,
  type Exemption,
  pathOf,
  TrackedTree,
  trackedFiles,
} from "./doc-citations";

/**
 * Every file path a standards document cites in backticks names a file git
 * tracks (#439, `docs/plans/doc-citations.md` slice 1). A rename that leaves
 * a citation behind fails `git push` here, naming the document, the line and
 * the missing path, so the doc fix lands in the same branch as the rename.
 *
 * Paths only, and `docs/standards/` only, for now: symbols and the wider walk
 * are the plan's later slices. The index and the resolver are
 * `doc-citations.ts`; this file holds the exemptions and shows the check what
 * it must catch and what it must pass, the way `standards-guard.test.ts` does.
 *
 * Nothing is mocked, and nothing here touches the database or the network.
 */

/** The repository root, which every document and tracked path is relative to. */
const REPO_ROOT = path.resolve(import.meta.dir, "../../..");

/** The documents in scope. */
const IN_SCOPE = (file: string) =>
  file.startsWith("docs/standards/") && file.endsWith(".md");

/**
 * Citations that name no tracked file on purpose. Each names its document and
 * says why; one that stops matching an unresolved citation fails the check, so
 * a fixed citation takes its exemption with it. Never mark the prose instead.
 */
const EXEMPTIONS: Exemption[] = [
  {
    doc: "docs/standards/testing-api.md",
    citation: "src/x.test.ts",
    reason: "A placeholder test path in an example command, not a file.",
  },
  {
    doc: "docs/standards/backend.md",
    citation: "dist/utils/get-request-ip.mjs",
    reason:
      "A path inside the installed better-auth package, under node_modules.",
  },
  {
    doc: "docs/standards/conventions.md",
    citation: "MEMORY.md",
    reason:
      "A subagent's own memory file, kept outside the repo by Claude Code.",
  },
  {
    doc: "docs/standards/frontend.md",
    citation: "protocol.ts",
    reason:
      "History: the one module the dev tools' contracts were split out of in #284.",
  },
  {
    doc: "docs/standards/frontend.md",
    citation: ".vite/stats.html",
    reason: "Build output, gitignored: the bundle report a build writes.",
  },
  {
    doc: "docs/standards/security.md",
    citation: "dist/index.html",
    reason: "Build output, gitignored: the web build's emitted page.",
  },
];

const TRACKED = trackedFiles(REPO_ROOT);
const TREE = new TrackedTree(TRACKED);
const DOCS = TRACKED.filter(IN_SCOPE);
const CITATIONS = DOCS.flatMap((doc) =>
  citationsIn(doc, readFileSync(path.join(REPO_ROOT, doc), "utf8")),
);

test("the walk reads the documents it means to", () => {
  // An empty walk is a green run that checked nothing: the directory moved,
  // or git listed nothing.
  expect(DOCS.length).toBeGreaterThanOrEqual(10);
  expect(DOCS).toContain("docs/standards/testing-api.md");
  expect(DOCS).toContain("docs/standards/frontend.md");
  expect(CITATIONS.length).toBeGreaterThan(300);
});

test("every path a standards document cites is a tracked file", () => {
  const report = checkCitations(CITATIONS, TREE, EXEMPTIONS);
  expect(report.stale).toEqual([]);
  expect(report.unusedExemptions).toEqual([]);
});

test("every exemption names a document in scope, and a reason", () => {
  for (const exemption of EXEMPTIONS) {
    expect(DOCS).toContain(exemption.doc);
    expect(exemption.reason.length).toBeGreaterThan(0);
  }
});

/* ── The check, shown what it must catch and what it must pass ───────────── */

const PLANTED_TREE = new TrackedTree([
  "apps/api/src/ai/provider.ts",
  "docs/standards/backend.md",
  "package.json",
]);
const DOC = "docs/standards/planted.md";

describe("a stale path", () => {
  test("fails, naming the document, the line and the path", () => {
    const citations = citationsIn(
      DOC,
      "# Planted\n\nSee `apps/api/src/ai/provider.ts`.\nNow `apps/api/src/ai/old-provider.ts`.\n",
    );
    expect(checkCitations(citations, PLANTED_TREE, []).stale).toEqual([
      "docs/standards/planted.md:4 cites `apps/api/src/ai/old-provider.ts`, which no tracked file matches",
    ]);
  });

  test("passes when an exemption names it in that document", () => {
    const citations = citationsIn(DOC, "Was one `protocol.ts`.\n");
    const report = checkCitations(citations, PLANTED_TREE, [
      { doc: DOC, citation: "protocol.ts", reason: "history" },
    ]);
    expect(report).toEqual({ stale: [], unusedExemptions: [] });
  });

  test("still fails when the exemption names another document", () => {
    const citations = citationsIn(DOC, "Was one `protocol.ts`.\n");
    const report = checkCitations(citations, PLANTED_TREE, [
      { doc: "docs/standards/other.md", citation: "protocol.ts", reason: "x" },
    ]);
    expect(report.stale).toHaveLength(1);
    expect(report.unusedExemptions).toHaveLength(1);
  });
});

test("an exemption that matches no unresolved citation fails", () => {
  // The citation was fixed, so it resolves, and the exemption excuses nothing.
  const citations = citationsIn(DOC, "See `provider.ts`.\n");
  const report = checkCitations(citations, PLANTED_TREE, [
    { doc: DOC, citation: "provider.ts", reason: "was missing" },
    { doc: DOC, citation: "gone.ts", reason: "never cited" },
  ]);
  expect(report.stale).toEqual([]);
  expect(report.unusedExemptions).toEqual([
    "docs/standards/planted.md exempts `provider.ts`, which no longer fails: remove the exemption",
    "docs/standards/planted.md exempts `gone.ts`, which no longer fails: remove the exemption",
  ]);
});

describe("one rule for a short citation and a full one: a tracked path, or its tail from a /", () => {
  test.each([
    "apps/api/src/ai/provider.ts",
    "src/ai/provider.ts",
    "ai/provider.ts",
    "provider.ts",
    "./ai/provider.ts",
    "../ai/provider.ts",
    "provider.ts:42",
    "provider.ts:42-50",
    "backend.md#outbox",
  ])("%s resolves", (text) => {
    expect(TREE.resolves(pathOf(text)!)).toBe(true);
  });

  test.each([
    "rovider.ts",
    "api/provider.ts",
    "apps/api/provider.ts",
    "ai/Provider.ts",
  ])("%s does not", (text) => {
    expect(PLANTED_TREE.resolves(pathOf(text)!)).toBe(false);
  });
});

describe("what counts as a path", () => {
  test.each([
    "Output.object",
    "z.infer",
    "prisma.$transaction",
    "*.test.ts",
    "docs/standards/<file>.md",
    "/api/tickets.json",
    "https://example.com/a.md",
    "bun test src/x.test.ts",
    ".env",
    "docs/adr/0014",
  ])("%s is not one", (text) => {
    expect(pathOf(text)).toBeUndefined();
  });

  test("a fenced block holds code, not citations", () => {
    const markdown =
      "````md\n```\n`gone.ts`\n```\n````\nAfter `kept.ts`.\n~~~\n`also-gone.ts`\n~~~\n";
    expect(citationsIn(DOC, markdown)).toEqual([
      { doc: DOC, line: 6, text: "kept.ts" },
    ]);
  });

  test("a double-backtick span is read whole", () => {
    expect(citationsIn(DOC, "Run ``a.ts`` and `b.ts`.")).toEqual([
      { doc: DOC, line: 1, text: "a.ts" },
      { doc: DOC, line: 1, text: "b.ts" },
    ]);
  });
});

test("a CRLF checkout and an LF one index the same citations at the same lines", () => {
  const lf =
    "# Doc\n\nSee `provider.ts`.\n\n```\n`x.ts`\n```\nAnd `gone.ts`.\n";
  const crlf = lf.replace(/\n/g, "\r\n");
  expect(citationsIn(DOC, crlf)).toEqual(citationsIn(DOC, lf));
  expect(citationsIn(DOC, lf).map((c) => c.line)).toEqual([3, 8]);
});
