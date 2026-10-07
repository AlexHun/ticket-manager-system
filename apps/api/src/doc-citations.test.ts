import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  checkCitations,
  type Exemption,
  isSymbolSource,
  SymbolIndex,
  symbolSources,
  TrackedTree,
  trackedFiles,
} from "./doc-citations";

/**
 * Every path a standards document or ADR cites in backticks names a file git
 * tracks (#439), and every code symbol it cites is still named somewhere in
 * the repo's source, tests or config outside a comment (#440;
 * `docs/plans/doc-citations.md` slices 1 and 2). A rename that leaves a
 * citation behind fails `git push` here, naming the document, the line and
 * the missing path or symbol, so the doc fix lands in the same branch as the
 * rename. The bullet is the pre-push one in `docs/standards/conventions.md`.
 *
 * `docs/standards/` and `docs/adr/` only, for now: CLAUDE.md files, skills and
 * agents are the plan's slice 3. The index and the resolvers are
 * `doc-citations.ts`, which states what counts as a path and as a symbol, and
 * records the measurement the symbol rule was chosen on; this file holds the
 * exemptions and shows the check what it must catch and what it must pass, the
 * way `standards-guard.test.ts` does.
 *
 * Nothing is mocked, and nothing here touches the database or the network.
 */

/** The repository root, which every document and tracked path is relative to. */
const REPO_ROOT = path.resolve(import.meta.dir, "../../..");

/** The standards file whose bullet this check holds. */
const STANDARD = "docs/standards/conventions.md";

/** The documents in scope. */
const IN_SCOPE = (file: string) =>
  (file.startsWith("docs/standards/") || file.startsWith("docs/adr/")) &&
  file.endsWith(".md");

const GITIGNORED = "Gitignored, so never tracked:";

/** The two kinds a symbol exemption may be (`docs/prd/doc-citations.md`, R3). */
const HISTORY = "History:";
const EXTERNAL = "A library or tool name, not this repo's code:";

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
    reason: `${GITIGNORED} the bundle report a web build writes.`,
  },
  {
    doc: "docs/standards/security.md",
    citation: "dist/index.html",
    reason: `${GITIGNORED} the page the web build emits.`,
  },
  {
    doc: "docs/standards/security.md",
    citation: "apps/web/csp.caddy",
    reason: `${GITIGNORED} the CSP header file the web build emits.`,
  },
  {
    doc: "docs/standards/backend.md",
    citation: "apps/api/src/generated/prisma",
    reason: `${GITIGNORED} the client \`prisma generate\` writes.`,
  },
  {
    doc: "docs/standards/testing.md",
    citation: "apps/api/.env",
    reason: `${GITIGNORED} each developer's own environment file.`,
  },
  {
    doc: "docs/standards/frontend.md",
    citation: "tests/e2e/fixtures/transcripts.local",
    reason: `${GITIGNORED} the local-only fixture directory, kept out on purpose.`,
  },
  {
    doc: "docs/standards/frontend.md",
    citation: "tests/e2e/fixtures/usage-history.local.sqlite",
    reason: `${GITIGNORED} the local-only usage database, kept out on purpose.`,
  },

  // The ADRs' paths.
  {
    doc: "docs/adr/0014-api-tests-run-against-a-real-postgres-in-process.md",
    citation: "Prisma.sql",
    reason:
      "A symbol, Prisma's tagged template, that happens to look like a file.",
  },
  {
    doc: "docs/adr/0014-api-tests-run-against-a-real-postgres-in-process.md",
    citation: "src/x.test.ts",
    reason: "A placeholder test path in an example command, not a file.",
  },
  {
    doc: "docs/adr/0014-api-tests-run-against-a-real-postgres-in-process.md",
    citation: "apps/api/node_modules/.cache/pglite",
    reason: `${GITIGNORED} the baked schema cache the in-process Postgres writes under node_modules.`,
  },
  {
    doc: "docs/adr/0022-a-demo-session-is-an-anonymous-agent.md",
    citation: "dist/plugins/anonymous/index.mjs",
    reason:
      "A path inside the installed better-auth package, under node_modules.",
  },
  {
    doc: "docs/adr/0017-assembling-a-prompts-input-is-not-a-module.md",
    citation: "classify.test.ts",
    reason:
      "A test file the ADR names as not existing: the gap its argument is about.",
  },

  // Symbols: every one is history or a library or tool name.
  ...[
    [
      "docs/adr/0017-assembling-a-prompts-input-is-not-a-module.md",
      "emailFacts",
      "the module the ADR considered and rejected.",
    ],
    [
      "docs/adr/0017-assembling-a-prompts-input-is-not-a-module.md",
      "hasInbound",
      "`preflight.hasInbound`, a boolean until #221 made it `inboundCount`.",
    ],
    [
      "docs/adr/0020-a-second-unread-email-is-not-an-opening.md",
      "hasInbound",
      "`preflight.hasInbound`, a boolean until #221 made it `inboundCount`.",
    ],
    [
      "docs/standards/security-auto-reply.md",
      "hasInbound",
      "`preflight.hasInbound`, a boolean until #221 made it `inboundCount`.",
    ],
    [
      "docs/adr/0018-a-measuring-module-reads-the-taxonomy-not-the-retry-table.md",
      "AutoReplyOutcome",
      "the local twin of `AutoReplyResult` the ADR removed from a test.",
    ],
    [
      "docs/adr/0021-a-planned-run-is-not-a-run.md",
      "stopRequestedAt",
      "a column the ADR decided not to add.",
    ],
    [
      "docs/standards/frontend.md",
      "UNSTARTED_RANK",
      "the sink value #286 deleted.",
    ],
    [
      "docs/standards/frontend.md",
      "emptyScan",
      "renamed `emptyRead` in #417, as the bullet says.",
    ],
    [
      "docs/standards/testing.md",
      "renderWithQuery",
      "a helper the bullet records as deleted.",
    ],
    [
      "docs/standards/testing.md",
      "mockGet",
      "the hand-rolled stub shape the shared API stub replaced.",
    ],
  ].map(([doc, citation, why]) => ({
    doc: doc!,
    citation: citation!,
    reason: `${HISTORY} ${why}`,
  })),
  ...[
    [
      "docs/adr/0010-no-email-verification.md",
      "requireEmailVerification",
      "Better Auth's email-and-password option.",
    ],
    [
      "docs/standards/backend.md",
      "requireEmailVerification",
      "Better Auth's email-and-password option.",
    ],
    [
      "docs/adr/0011-nobody-types-somebody-elses-password.md",
      "setUserPassword",
      "a Better Auth admin endpoint.",
    ],
    [
      "docs/standards/backend.md",
      "setUserPassword",
      "a Better Auth admin endpoint.",
    ],
    [
      "docs/adr/0014-api-tests-run-against-a-real-postgres-in-process.md",
      "_prisma_migrations",
      "the table Prisma records applied migrations in.",
    ],
    [
      "docs/adr/0022-a-demo-session-is-an-anonymous-agent.md",
      "changeEmail",
      "a Better Auth option this app does not enable.",
    ],
    [
      "docs/adr/0022-a-demo-session-is-an-anonymous-agent.md",
      "deleteUser",
      "a Better Auth option this app does not enable.",
    ],
    [
      "docs/adr/0022-a-demo-session-is-an-anonymous-agent.md",
      "sendVerificationEmail",
      "a Better Auth option this app does not enable.",
    ],
    [
      "docs/standards/backend.md",
      "changeEmail",
      "a Better Auth option this app does not enable.",
    ],
    [
      "docs/standards/backend.md",
      "deleteUser",
      "a Better Auth option this app does not enable.",
    ],
    [
      "docs/standards/backend.md",
      "sendVerificationEmail",
      "a Better Auth option this app does not enable.",
    ],
    [
      "docs/standards/backend.md",
      "emailVerification",
      "a Better Auth option this app does not enable.",
    ],
    [
      "docs/adr/0023-the-usage-page-keeps-responses-not-answers.md",
      "cleanupPeriodDays",
      "a Claude Code setting.",
    ],
    ["docs/standards/backend.md", "PrismaPromise", "a Prisma client type."],
    ["docs/standards/testing-api.md", "PrismaPromise", "a Prisma client type."],
    [
      "docs/standards/backend.md",
      "updateAge",
      "a Better Auth session option this app leaves at its default.",
    ],
    [
      "docs/standards/backend.md",
      "expiresIn",
      "a Better Auth session option this app leaves at its default.",
    ],
    [
      "docs/standards/backend.md",
      "trustedProxies",
      "a Better Auth option this app does not set.",
    ],
    [
      "docs/standards/backend.md",
      "NO_TRUSTED_IP_KEY",
      "a constant inside the installed better-auth package.",
    ],
    [
      "docs/standards/backend.md",
      "getIP",
      "a function inside the installed better-auth package.",
    ],
    [
      "docs/standards/backend.md",
      "oidcProvider",
      "a Better Auth plugin this app does not load.",
    ],
    ["docs/standards/conventions.md", "WebFetch", "a Claude Code tool."],
    ["docs/standards/conventions.md", "SameSite", "a cookie attribute."],
    [
      "docs/standards/deployment.md",
      "__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS",
      "Vite's variable, set on Railway rather than in the repo.",
    ],
    [
      "docs/standards/frontend.md",
      "__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS",
      "Vite's variable, set on Railway rather than in the repo.",
    ],
    [
      "docs/standards/frontend.md",
      "selectOptions",
      "Testing Library's, which the bullet says does not work here.",
    ],
    [
      "docs/standards/testing.md",
      "selectOptions",
      "Testing Library's, which the bullet says does not work here.",
    ],
    [
      "docs/standards/frontend.md",
      "selectOption",
      "Playwright's, which the bullet says does not work here.",
    ],
    [
      "docs/standards/frontend.md",
      "columnSizing",
      "TanStack Table's state key, kept uncontrolled on purpose.",
    ],
    [
      "docs/standards/frontend.md",
      "setColumnSizingInfo",
      "TanStack Table's internal updater.",
    ],
    [
      "docs/standards/frontend.md",
      "tool_use",
      "a content-block type in Claude Code's transcripts.",
    ],
    ["docs/standards/security.md", "remote_ip", "a Caddy matcher."],
    [
      "docs/standards/testing.md",
      "MemoryRouter",
      "React Router's, which the deleted helper mounted.",
    ],
  ].map(([doc, citation, what]) => ({
    doc: doc!,
    citation: citation!,
    reason: `${EXTERNAL} ${what}`,
  })),
];

const TRACKED = trackedFiles(REPO_ROOT);
const TREE = new TrackedTree(TRACKED);
const SYMBOLS = new SymbolIndex(symbolSources(REPO_ROOT, TRACKED));
const DOCS = TRACKED.filter(IN_SCOPE);
const CITATIONS = DOCS.flatMap((doc) =>
  TREE.citationsIn(doc, readFileSync(path.join(REPO_ROOT, doc), "utf8")),
);

describe(`Cited paths and symbols in the standards and ADRs exist (${STANDARD})`, () => {
  test("the walk reads the documents it means to", () => {
    // An empty walk is a green run that checked nothing: a directory moved,
    // or git listed nothing.
    expect(DOCS.length).toBeGreaterThanOrEqual(30);
    expect(DOCS).toContain("docs/standards/testing-api.md");
    expect(DOCS).toContain("docs/standards/frontend.md");
    expect(DOCS).toContain(
      "docs/adr/0014-api-tests-run-against-a-real-postgres-in-process.md",
    );
    const kinds = (kind: string) =>
      CITATIONS.filter((c) => c.kind === kind).length;
    expect(kinds("path")).toBeGreaterThan(300);
    expect(kinds("symbol")).toBeGreaterThan(1000);
  });

  test("the symbols resolve against the source, not an empty corpus", () => {
    expect(SYMBOLS.resolves("requireAdmin")).toBe(true);
    expect(SYMBOLS.resolves("TableFrame")).toBe(true);
    // This check's own files are not source: their tables name every
    // exempted symbol as a string.
    expect(SYMBOLS.resolves("checkCitations")).toBe(false);
  });

  test("every symbol exemption is history or a library or tool name", () => {
    for (const { citation, reason } of EXEMPTIONS) {
      if (TREE.pathOf(citation) !== undefined) continue;
      const kind = [HISTORY, EXTERNAL].find((k) => reason.startsWith(`${k} `));
      // The citation rides along so a failure names the exemption.
      expect({ citation, kind }).toEqual({
        citation,
        kind: expect.any(String),
      });
    }
  });

  test("every path and symbol a standards document or ADR cites exists", () => {
    const report = checkCitations(CITATIONS, TREE, SYMBOLS, EXEMPTIONS);
    expect(report.stale).toEqual([]);
    expect(report.unusedExemptions).toEqual([]);
  });

  test("every exemption names a document in scope, and a reason", () => {
    for (const exemption of EXEMPTIONS) {
      expect(DOCS).toContain(exemption.doc);
      expect(exemption.reason.length).toBeGreaterThan(0);
    }
  });
});

/* ── The check, shown what it must catch and what it must pass ───────────── */

const PLANTED_TREE = new TrackedTree([
  ".husky/pre-push",
  "apps/api/Dockerfile",
  "apps/api/src/ai/provider.ts",
  "docs/adr/0014-in-process-postgres.md",
  "docs/standards/backend.md",
  "package.json",
]);
const PLANTED_SYMBOLS = new SymbolIndex([
  {
    file: "apps/web/src/lib/table-frame.tsx",
    text: "// Was TABLE_FRAME, a class string.\nexport function TableFrame() {}\n/* useTheme is gone */\nconst s = '// notAComment';\n",
  },
  {
    file: ".github/workflows/ci.yml",
    text: "# watchPatterns\nkey: ${{ hashFiles('bun.lock') }}\n",
  },
  {
    file: "apps/web/Caddyfile",
    text: "reverse_proxy {$API_UPSTREAM:localhost:3001}\n",
  },
  {
    file: "apps/api/prisma/schema.prisma",
    text: "model Ticket { // legacyField\n  id String\n}\n",
  },
  {
    file: "apps/api/prisma/migrations/1/migration.sql",
    text: "-- old_column\nCREATE TABLE t (new_column int);\n",
  },
]);

const PLANTED_DOC = "docs/standards/planted.md";
const plantedCitations = (markdown: string) =>
  PLANTED_TREE.citationsIn(PLANTED_DOC, markdown);

describe("a stale path", () => {
  test("fails, naming the document, the line and the path", () => {
    const citations = plantedCitations(
      "# Planted\n\nSee `apps/api/src/ai/provider.ts`.\nNow `apps/api/src/ai/old-provider.ts` and `.husky/pre-commit`.\n",
    );
    expect(
      checkCitations(citations, PLANTED_TREE, PLANTED_SYMBOLS, []).stale,
    ).toEqual([
      "docs/standards/planted.md:4 cites `apps/api/src/ai/old-provider.ts`, which no tracked file matches",
      "docs/standards/planted.md:4 cites `.husky/pre-commit`, which no tracked file matches",
    ]);
  });

  test("passes when an exemption names it in that document", () => {
    const citations = plantedCitations("Was one `protocol.ts`.\n");
    const report = checkCitations(citations, PLANTED_TREE, PLANTED_SYMBOLS, [
      { doc: PLANTED_DOC, citation: "protocol.ts", reason: "history" },
    ]);
    expect(report).toEqual({ stale: [], unusedExemptions: [] });
  });

  test("still fails when the exemption names another document", () => {
    const citations = plantedCitations("Was one `protocol.ts`.\n");
    const report = checkCitations(citations, PLANTED_TREE, PLANTED_SYMBOLS, [
      { doc: "docs/standards/other.md", citation: "protocol.ts", reason: "x" },
    ]);
    expect(report.stale).toHaveLength(1);
    expect(report.unusedExemptions).toHaveLength(1);
  });
});

test("an exemption that matches no unresolved citation fails", () => {
  // The citation was fixed, so it resolves, and the exemption excuses nothing.
  const citations = plantedCitations("See `provider.ts`.\n");
  const report = checkCitations(citations, PLANTED_TREE, PLANTED_SYMBOLS, [
    { doc: PLANTED_DOC, citation: "provider.ts", reason: "was missing" },
    { doc: PLANTED_DOC, citation: "gone.ts", reason: "never cited" },
  ]);
  expect(report.stale).toEqual([]);
  expect(report.unusedExemptions).toEqual([
    "docs/standards/planted.md exempts `provider.ts`, which no longer fails: remove the exemption",
    "docs/standards/planted.md exempts `gone.ts`, which no longer fails: remove the exemption",
  ]);
});

const resolves = (text: string) => {
  const cited = PLANTED_TREE.pathOf(text);
  if (cited === undefined) throw new Error(`${text} is not a path`);
  return PLANTED_TREE.resolves(cited);
};

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
    expect(resolves(text)).toBe(true);
  });

  test.each([
    "rovider.ts",
    "api/provider.ts",
    "apps/api/provider.ts",
    "ai/Provider.ts",
  ])("%s does not", (text) => {
    expect(resolves(text)).toBe(false);
  });
});

describe("a path with no extension is anchored at a top-level directory, and resolves exactly", () => {
  test.each([
    ".husky/pre-push",
    "apps/api/Dockerfile",
    "apps/api",
    "apps/api/src/",
    "docs/adr/0014",
  ])("%s resolves", (text) => {
    expect(resolves(text)).toBe(true);
  });

  test.each([
    ".husky/pre-commit",
    "apps/web",
    "apps/api/src/ai/provider",
    "docs/adr/001",
    "docs/adr/0015",
  ])("%s does not", (text) => {
    expect(resolves(text)).toBe(false);
  });
});

/* ── Symbols: a whole word in comment-stripped source, tests and config ──── */

describe("a stale symbol", () => {
  test("fails, naming the document, the line and the symbol", () => {
    const citations = plantedCitations(
      "# Planted\n\nWrap it in `TableFrame`.\nNot `TABLE_FRAME`, and theme it from `useTheme()`.\n",
    );
    expect(
      checkCitations(citations, PLANTED_TREE, PLANTED_SYMBOLS, []).stale,
    ).toEqual([
      "docs/standards/planted.md:4 cites `TABLE_FRAME`, which no source, test or config file names outside a comment",
      "docs/standards/planted.md:4 cites `useTheme`, which no source, test or config file names outside a comment",
    ]);
  });

  test.each([
    ["a // line comment", "TABLE_FRAME"],
    ["a /* block */ comment", "useTheme"],
    ["a # comment in YAML", "watchPatterns"],
    ["a // comment in schema.prisma", "legacyField"],
    ["a -- comment in SQL", "old_column"],
  ])("that survives only in %s still fails", (_, symbol) => {
    expect(PLANTED_SYMBOLS.resolves(symbol)).toBe(false);
  });

  test.each([
    "TableFrame",
    "hashFiles",
    "API_UPSTREAM",
    "new_column",
    "notAComment",
  ])("%s, named in code or inside a string, resolves", (symbol) => {
    expect(PLANTED_SYMBOLS.resolves(symbol)).toBe(true);
  });

  test("a part of a longer word is not the word", () => {
    expect(PLANTED_SYMBOLS.resolves("Table")).toBe(false);
    expect(PLANTED_SYMBOLS.resolves("ableFrame")).toBe(false);
  });

  test("an exempted library name passes", () => {
    const citations = plantedCitations("Claude Code's `WebFetch` tool.\n");
    const report = checkCitations(citations, PLANTED_TREE, PLANTED_SYMBOLS, [
      { doc: PLANTED_DOC, citation: "WebFetch", reason: "a tool name" },
    ]);
    expect(report).toEqual({ stale: [], unusedExemptions: [] });
  });
});

describe("what counts as a symbol", () => {
  const symbolsIn = (span: string) =>
    plantedCitations(`See \`${span}\`.\n`)
      .filter((c) => c.kind === "symbol")
      .map((c) => c.name);

  test.each([
    ["useTheme", ["useTheme"]],
    ["useTheme()", ["useTheme"]],
    ["TableFrame", ["TableFrame"]],
    ["TABLE_FRAME", ["TABLE_FRAME"]],
    ["tool_use", ["tool_use"]],
    ["$transaction", ["$transaction"]],
    ["prisma.$queryRaw", ["$queryRaw"]],
    ["ROUTE.users.timingKey", ["timingKey"]],
    ["Prisma.TransactionClient", ["TransactionClient"]],
  ])("%s names %j", (span, names) => {
    expect(symbolsIn(span)).toEqual(names);
  });

  test.each([
    // Plain words: as often English, SQL or a header as a name in this code.
    "select",
    "Prisma",
    "NOTIFY",
    "P2002",
    // Not one identifier.
    "asCaller(who, { cached: true })",
    'theme="dark"',
    "z.infer<typeof schema>",
    "forecast/S",
    // A path, which the path half reads.
    "provider.ts",
  ])("%s names none", (span) => {
    expect(symbolsIn(span)).toEqual([]);
  });
});

describe("which files a symbol may resolve in", () => {
  test.each([
    "apps/api/src/ai/provider.ts",
    "apps/web/src/main.tsx",
    ".github/workflows/ci.yml",
    "apps/web/Caddyfile",
    "apps/api/prisma/schema.prisma",
    ".claude/settings.json",
    ".claude/hooks/block-no-verify.mjs",
  ])("%s is source, a test or config", (file) => {
    expect(isSymbolSource(file)).toBe(true);
  });

  test.each([
    "docs/standards/frontend.md",
    "CLAUDE.md",
    ".agents/skills/shadcn/evals/evals.json",
    ".claude/skills/shadcn/evals/evals.json",
    "packages/shared/src/changelog-entries.json",
    "apps/api/src/doc-citations.ts",
    "apps/api/src/doc-citations.test.ts",
    "tests/e2e/fixtures/transcripts/session-a.jsonl",
    "bun.lock",
    "apps/web/public/favicon.png",
  ])("%s is not", (file) => {
    expect(isSymbolSource(file)).toBe(false);
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
    "try/catch",
    "@ticket/shared",
    "../db",
    "src/routes/",
    "~/.claude",
  ])("%s is not one", (text) => {
    expect(PLANTED_TREE.pathOf(text)).toBeUndefined();
  });

  test("a fenced block holds code, not citations", () => {
    const markdown =
      "````md\n```\n`gone.ts`\n```\n````\nAfter `kept.ts`.\n~~~\n`also-gone.ts`\n~~~\n";
    expect(plantedCitations(markdown)).toEqual([
      {
        doc: PLANTED_DOC,
        line: 6,
        text: "kept.ts",
        kind: "path",
        name: "kept.ts",
      },
    ]);
  });

  test("a double-backtick span is read whole", () => {
    expect(
      plantedCitations("Run ``a.ts`` and `b.ts`.").map((c) => c.text),
    ).toEqual(["a.ts", "b.ts"]);
  });
});

test("a CRLF checkout and an LF one index the same citations at the same lines", () => {
  const lf =
    "# Doc\n\nSee `provider.ts`.\n\n```\n`x.ts`\n```\nAnd `gone.ts`.\n";
  const crlf = lf.replace(/\n/g, "\r\n");
  expect(plantedCitations(crlf)).toEqual(plantedCitations(lf));
  expect(plantedCitations(lf).map((c) => c.line)).toEqual([3, 8]);
});
