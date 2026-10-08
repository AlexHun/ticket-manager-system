import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  checkCitations,
  documentsInScope,
  type Exemption,
  isSymbolSource,
  renameHints,
  SymbolIndex,
  symbolSources,
  TrackedTree,
  trackedFiles,
  unknownExclusions,
} from "./doc-citations";

/**
 * Every path a standards document, ADR, `CLAUDE.md`, skill, agent or open PRD
 * cites in backticks names a file git tracks (#439), and every code symbol it
 * cites is still named somewhere in the repo's source, tests or config outside
 * a comment (#440, #441, #442; `docs/plans/doc-citations.md` slices 1 to 4). A
 * PRD whose header says `Status: Shipped` is history and is not read. A rename
 * that leaves a citation behind fails `git push` here, naming the document,
 * the line and the missing path or symbol, and on a full clone the new name
 * and the commit that renamed it (#443, slice 5), so the doc fix lands in the
 * same branch as the rename. The bullet is the pre-push one in
 * `docs/standards/conventions.md`.
 *
 * The index, the resolvers and the scope are `doc-citations.ts`, which states
 * what counts as a path and as a symbol, which documents are read, and
 * records the measurement the symbol rule was chosen on; this file holds the
 * excluded skills and the exemptions, and shows the check what it must catch
 * and what it must pass, the way `standards-guard.test.ts` does.
 *
 * Nothing is mocked, and nothing here touches the database or the network.
 * The rename hint's cases build a git repository of their own in a temporary
 * directory, so they do not depend on this repository's history or depth.
 */

/** The repository root, which every document and tracked path is relative to. */
const REPO_ROOT = path.resolve(import.meta.dir, "../../..");

/** The standards file whose bullet this check holds. */
const STANDARD = "docs/standards/conventions.md";

/**
 * Skills under `.claude/skills/` that are not read, each because it describes
 * a library's API rather than this repo: on 2026-10-08 they held 756 of the
 * 795 unresolved citations in every skill and agent, nearly all of them the
 * library's own names. A skill not named here is read, so one added later is
 * checked until someone names it. A name that is no longer a skill directory
 * fails the check.
 */
const EXCLUDED_SKILLS = [
  // shadcn/ui's Radix-to-Base-UI migration guide.
  "migrate-radix-to-base",
  // shadcn/ui's CLI, registry and component reference.
  "shadcn",
  // Better Auth's configuration reference.
  "better-auth-best-practices",
];

const GITIGNORED = "Gitignored, so never tracked:";
const MEMORY = "A Claude Code memory file, kept outside the repo:";

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
    reason: `${MEMORY} a subagent's own memory index.`,
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

  // The skills' and agents' paths.
  ...[
    [".claude/agents/linkedin-fact-checker.md", "docs/linkedin/profile.md"],
    [".claude/agents/linkedin-fact-checker.md", "docs/linkedin/BRAND.md"],
    [".claude/agents/linkedin-fact-checker.md", "profile.md"],
    [".claude/agents/linkedin-former-colleague.md", "docs/linkedin/profile.md"],
    [".claude/agents/linkedin-former-colleague.md", "docs/linkedin/VOICE.md"],
    [".claude/agents/linkedin-former-colleague.md", "profile.md"],
    [".claude/agents/linkedin-slop-critic.md", "docs/linkedin/VOICE.md"],
    [".claude/agents/linkedin-slop-critic.md", "docs/linkedin/BRAND.md"],
    [".claude/agents/linkedin-target-reader.md", "docs/linkedin/BRAND.md"],
    [".claude/skills/linkedin/POSTS.md", "docs/linkedin/posts/NN-slug.md"],
    [".claude/skills/linkedin/SKILL.md", "docs/linkedin"],
    [".claude/skills/linkedin/SKILL.md", "profile.md"],
    [".claude/skills/linkedin/SKILL.md", "BRAND.md"],
    [".claude/skills/linkedin/SKILL.md", "VOICE.md"],
    [".claude/skills/linkedin/SKILL.md", "plan.md"],
    [".claude/skills/linkedin/SKILL.md", "posts/NN-slug.md"],
  ].map(([doc, citation]) => ({
    doc: doc!,
    citation: citation!,
    reason: `${GITIGNORED} the LinkedIn skill's working files under \`docs/linkedin/\`, personal and kept out on purpose.`,
  })),
  {
    doc: ".claude/agents/playwright-e2e-author.md",
    citation: "apps/api/.env.test",
    reason: `${GITIGNORED} each developer's own E2E environment file.`,
  },
  {
    doc: ".claude/agents/playwright-e2e-author.md",
    citation: "ticket-assignment.spec.ts",
    reason: "An example of a descriptive spec name, not a file.",
  },
  ...[
    ["test_users.md", "the note the agent is told holds the test credentials."],
    ["MEMORY.md", "the agent's memory index."],
    [
      "user_role.md",
      "an example name for a memory note, in the agent's instructions.",
    ],
    [
      "feedback_testing.md",
      "an example name for a memory note, in the agent's instructions.",
    ],
  ].map(([citation, what]) => ({
    doc: ".claude/agents/playwright-e2e-author.md",
    citation: citation!,
    reason: `${MEMORY} ${what}`,
  })),

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
    [
      "docs/prd/doc-citations.md",
      "TABLE_FRAME",
      "one of the two stale names the PRD's problem statement counts, renamed `TableFrame` by R9's fix.",
    ],
    [
      "docs/prd/doc-citations.md",
      "useTheme",
      "one of the two stale names the PRD's problem statement counts, dropped from sonner by R9's fix.",
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
      "docs/prd/doc-citations.md",
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
    [
      ".claude/agents/playwright-e2e-author.md",
      "storageState",
      "Playwright's saved-session option, which this suite does not use yet.",
    ],
    [
      ".claude/agents/security-vulnerability-auditor.md",
      "httpOnly",
      "a cookie attribute Better Auth sets by default.",
    ],
    [
      ".claude/agents/security-vulnerability-auditor.md",
      "$queryRawUnsafe",
      "the Prisma method the reviewer is told to look for, which this code never calls.",
    ],
    [
      ".claude/skills/write-a-prd/SKILL.md",
      "AskUserQuestion",
      "a Claude Code tool.",
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
const readDoc = (doc: string) =>
  readFileSync(path.join(REPO_ROOT, doc), "utf8");
const DOCS = documentsInScope(TRACKED, EXCLUDED_SKILLS, readDoc);
const CITATIONS = DOCS.flatMap((doc) => TREE.citationsIn(doc, readDoc(doc)));

describe(`Cited paths and symbols in the documents agents read exist (${STANDARD})`, () => {
  test("the walk reads the documents it means to", () => {
    // An empty walk is a green run that checked nothing: a directory moved,
    // or git listed nothing.
    expect(DOCS.length).toBeGreaterThanOrEqual(55);
    for (const doc of [
      "docs/standards/testing-api.md",
      "docs/standards/frontend.md",
      "docs/adr/0014-api-tests-run-against-a-real-postgres-in-process.md",
      "CLAUDE.md",
      "apps/api/CLAUDE.md",
      "apps/web/CLAUDE.md",
      ".claude/skills/implement/SKILL.md",
      ".claude/agents/bulk-reader.md",
    ]) {
      expect(DOCS).toContain(doc);
    }
    expect(DOCS).not.toContain(".claude/skills/shadcn/SKILL.md");
    expect(DOCS.filter((doc) => doc.startsWith(".agents/"))).toEqual([]);
    // An open PRD is read; a shipped one and every plan are not.
    expect(DOCS).toContain("docs/prd/doc-citations.md");
    expect(DOCS).not.toContain("docs/prd/demo-session.md");
    expect(DOCS.filter((doc) => doc.startsWith("docs/plans/"))).toEqual([]);
    const kinds = (kind: string) =>
      CITATIONS.filter((c) => c.kind === kind).length;
    expect(kinds("path")).toBeGreaterThan(700);
    expect(kinds("symbol")).toBeGreaterThan(1000);
  });

  test("every excluded skill is a skill directory", () => {
    expect(unknownExclusions(TRACKED, EXCLUDED_SKILLS)).toEqual([]);
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

  test("every path and symbol a document in scope cites exists", () => {
    const report = checkCitations(
      CITATIONS,
      TREE,
      SYMBOLS,
      EXEMPTIONS,
      renameHints(REPO_ROOT, TREE, SYMBOLS),
    );
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

/* ── Which documents are read: skills, agents and open PRDs ──────────────── */

describe("the documents in scope", () => {
  const STALE = "Run `scripts/moved.ts` first.\n";
  const PLANTED_FILES: Record<string, string> = {
    "CLAUDE.md": "See `package.json`.\n",
    "apps/api/CLAUDE.md": "See `apps/api/Dockerfile`.\n",
    "docs/standards/backend.md": "See `provider.ts`.\n",
    ".claude/agents/planted-agent.md": "See `.husky/pre-push`.\n",
    ".claude/skills/planted/SKILL.md": STALE,
    ".claude/skills/planted/REFERENCE.md": "See `package.json`.\n",
    ".claude/skills/planted/scripts/run.mjs": "// `gone.ts`\n",
    ".claude/skills/library/SKILL.md": STALE,
    ".agents/skills/planted/SKILL.md": STALE,
    "docs/prd/open.md": `# PRD: Open\n\n**Status:** Draft · **Date:** 2026-10-08\n\n${STALE}`,
    "docs/prd/shipped.md": `# PRD: Shipped\n\n**Status:** Shipped · **Date:** 2026-10-08\n\n${STALE}`,
    "docs/plans/open.md": `# Plan: Open\n\n**Status:** Draft\n\n${STALE}`,
    "README.md": STALE,
  };
  const files = Object.keys(PLANTED_FILES);
  const read = (doc: string) => PLANTED_FILES[doc]!;

  test("are every CLAUDE.md, the standards, ADRs, open PRDs, skills and agents, less the excluded skills", () => {
    expect(documentsInScope(files, ["library"], read)).toEqual([
      "CLAUDE.md",
      "apps/api/CLAUDE.md",
      "docs/standards/backend.md",
      ".claude/agents/planted-agent.md",
      ".claude/skills/planted/SKILL.md",
      ".claude/skills/planted/REFERENCE.md",
      "docs/prd/open.md",
    ]);
  });

  test("a stale citation in a skill or an open PRD fails; an excluded skill, a shipped PRD and a plan are not read", () => {
    const citations = documentsInScope(files, ["library"], read).flatMap(
      (doc) => PLANTED_TREE.citationsIn(doc, read(doc)),
    );
    expect(
      checkCitations(citations, PLANTED_TREE, PLANTED_SYMBOLS, []).stale,
    ).toEqual([
      ".claude/skills/planted/SKILL.md:1 cites `scripts/moved.ts`, which no tracked file matches",
      "docs/prd/open.md:5 cites `scripts/moved.ts`, which no tracked file matches",
    ]);
  });

  test("a skill nobody has excluded is read", () => {
    expect(documentsInScope(files, [], read)).toContain(
      ".claude/skills/library/SKILL.md",
    );
  });

  test.each([
    ["**Status:** Shipped · **Author:** A · **Date:** 2026-10-08", true],
    ["**Status:** Shipped", true],
    ["**Status:** Draft · **Author:** A", false],
    ["**Status:** Shipped soon", false],
    ["**Status:** Not Shipped", false],
    ["Status: Shipped", true],
    ["**Status:** shipped", false],
    ["Status:** Shipped", false],
  ])("a PRD whose header reads %j is shipped: %p", (header, shipped) => {
    const prd = "docs/prd/x.md";
    const markdown = `# PRD: X\n\n${header}\n\n## Problem\n\nSee \`scripts/moved.ts\`.\n`;
    expect(documentsInScope([prd], [], () => markdown)).toEqual(
      shipped ? [] : [prd],
    );
  });

  test("a status below the header does not ship a PRD", () => {
    const markdown =
      "# PRD: X\n\n**Status:** Draft\n\n## Problem\n\n**Status:** Shipped\n";
    expect(documentsInScope(["docs/prd/x.md"], [], () => markdown)).toEqual([
      "docs/prd/x.md",
    ]);
  });

  test("an exclusion naming no skill directory fails", () => {
    expect(
      unknownExclusions(files, ["library", "planted", "renamed", "SKILL.md"]),
    ).toEqual(["renamed", "SKILL.md"]);
  });
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

/* ── The failure names the rename, from git history ──────────────────────── */

describe("a stale citation that git history shows was renamed", () => {
  /**
   * A repository of its own, so the hint is shown a rename this test made
   * rather than one this repo happens to have. Git runs with no global or
   * system config, so a developer's settings cannot change what it records.
   */
  const scratch = mkdtempSync(path.join(tmpdir(), "doc-citations-"));
  const repo = path.join(scratch, "full");
  const shallow = path.join(scratch, "shallow");
  const emptyConfig = path.join(scratch, "gitconfig");
  writeFileSync(emptyConfig, "");
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: emptyConfig,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Planted",
    GIT_AUTHOR_EMAIL: "planted@example.com",
    GIT_COMMITTER_NAME: "Planted",
    GIT_COMMITTER_EMAIL: "planted@example.com",
  };
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, env, encoding: "utf8" }).trim();
  const write = (file: string, text: string) =>
    writeFileSync(path.join(repo, file), text);
  // Each git call is a process, ~60ms on Windows, so the hashes are read once
  // at the end rather than after every commit.
  const commit = (message: string) => {
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", message);
  };

  mkdirSync(path.join(repo, "src"), { recursive: true });
  git(repo, "init", "-q");
  write(
    "src/provider.ts",
    'export const TABLE_FRAME = "frame";\nexport const frame = () => TABLE_FRAME;\n',
  );
  write("src/kept.ts", "export const keptName = 1;\n");
  write("src/index.ts", "export {\n  TABLE_FRAME,\n} from './provider';\n");
  commit("add the provider");
  git(repo, "mv", "src/provider.ts", "src/llm.ts");
  commit("rename the provider");
  write(
    "src/llm.ts",
    '// See TABLE_FRAME.\nexport const TableFrame = "frame";\nexport const frame = () => TableFrame;\n',
  );
  commit("rename the constant");
  // The last commit to touch the old name renames it in a comment, and swaps
  // a line that is the name alone for another lone name: neither is the
  // rename.
  write(
    "src/llm.ts",
    '// See TableFrame.\nexport const TableFrame = "frame";\nexport const frame = () => TableFrame;\n',
  );
  write("src/index.ts", "export {\n  frame,\n} from './llm';\n");
  commit("fix the comment and the index");
  const [, renamedIn, movedIn] = git(repo, "log", "--format=%h").split("\n");
  git(
    scratch,
    "clone",
    "-q",
    "--depth",
    "1",
    pathToFileURL(repo).href,
    shallow,
  );

  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  const DOC = "docs/standards/planted.md";
  const MARKDOWN =
    "See `provider.ts` and `src/provider.ts`, then `TABLE_FRAME`.\nNever `never-was.ts` or `neverWas`.\n";
  const staleIn = (root: string) => {
    const files = trackedFiles(root);
    const tree = new TrackedTree(files);
    const symbols = new SymbolIndex(symbolSources(root, files));
    return checkCitations(
      tree.citationsIn(DOC, MARKDOWN),
      tree,
      symbols,
      [],
      renameHints(root, tree, symbols),
    ).stale;
  };

  test("fails with the new name and the commit that renamed it, and a citation never renamed fails as before", () => {
    expect(staleIn(repo)).toEqual([
      `${DOC}:1 cites \`provider.ts\`, which no tracked file matches; renamed provider.ts → src/llm.ts (${movedIn})`,
      `${DOC}:1 cites \`src/provider.ts\`, which no tracked file matches; renamed src/provider.ts → src/llm.ts (${movedIn})`,
      `${DOC}:1 cites \`TABLE_FRAME\`, which no source, test or config file names outside a comment; renamed TABLE_FRAME → TableFrame (${renamedIn})`,
      `${DOC}:2 cites \`never-was.ts\`, which no tracked file matches`,
      `${DOC}:2 cites \`neverWas\`, which no source, test or config file names outside a comment`,
    ]);
  });

  test("on a shallow clone still fails, naming the document, line and citation, with no hint", () => {
    expect(git(shallow, "rev-parse", "--is-shallow-repository")).toBe("true");
    expect(staleIn(shallow)).toEqual([
      `${DOC}:1 cites \`provider.ts\`, which no tracked file matches`,
      `${DOC}:1 cites \`src/provider.ts\`, which no tracked file matches`,
      `${DOC}:1 cites \`TABLE_FRAME\`, which no source, test or config file names outside a comment`,
      `${DOC}:2 cites \`never-was.ts\`, which no tracked file matches`,
      `${DOC}:2 cites \`neverWas\`, which no source, test or config file names outside a comment`,
    ]);
  });

  test("outside a git repository, the lookup answers nothing rather than throwing", () => {
    const hint = renameHints(scratch, PLANTED_TREE, PLANTED_SYMBOLS);
    expect(
      hint({
        doc: DOC,
        line: 1,
        text: "provider.ts",
        kind: "path",
        name: "provider.ts",
      }),
    ).toBeUndefined();
  });

  test("a green run performs no history lookup", () => {
    const citations = plantedCitations("See `provider.ts` and `TableFrame`.\n");
    const report = checkCitations(
      citations,
      PLANTED_TREE,
      PLANTED_SYMBOLS,
      [],
      () => {
        throw new Error("looked up a citation that resolves");
      },
    );
    expect(report).toEqual({ stale: [], unusedExemptions: [] });
  });

  test("an exempted citation performs no history lookup either", () => {
    const citations = plantedCitations("Was one `protocol.ts`.\n");
    const report = checkCitations(
      citations,
      PLANTED_TREE,
      PLANTED_SYMBOLS,
      [{ doc: PLANTED_DOC, citation: "protocol.ts", reason: "history" }],
      () => {
        throw new Error("looked up an exempted citation");
      },
    );
    expect(report).toEqual({ stale: [], unusedExemptions: [] });
  });
});

test("a CRLF checkout and an LF one index the same citations at the same lines", () => {
  const lf =
    "# Doc\n\nSee `provider.ts`.\n\n```\n`x.ts`\n```\nAnd `gone.ts`.\n";
  const crlf = lf.replace(/\n/g, "\r\n");
  expect(plantedCitations(crlf)).toEqual(plantedCitations(lf));
  expect(plantedCitations(lf).map((c) => c.line)).toEqual([3, 8]);
});
