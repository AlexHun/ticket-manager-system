import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { stripComments } from "./test/strip-comments";

/**
 * The backend, AI, API-testing and repo-config standards a check can decide
 * without judgement, enforced here rather than left to whoever reads the diff
 * (#391). The web half is `apps/web/dev/standards-guard.test.ts` (#390).
 *
 * Built the way `jobs/boss.test.ts` guards the jobs directory: read the source
 * tree, fail on a banned pattern. Every rule names the standards file its
 * bullet lives in, and that bullet says this file holds it, so a reader of
 * either knows the other exists.
 *
 * **Each source rule matches a form, not a word.** `boss.test.ts` bans `.work(`
 * and `retryLimit:` rather than the bare names, and this file does the same for
 * the same reason: three AI modules already explain in a comment why they call
 * `generateText` and not `generateObject`. Matching runs over comment-stripped
 * source (`test/strip-comments.ts`), so an explanation never fails the build,
 * and each rule is shown a violation it must catch and a comment it must ignore.
 *
 * **The repo-wide config rules live here rather than in the web guard** because
 * this suite runs on pre-push as well as in CI, and the web suite only in CI:
 * a widened `better-auth` pin or a dropped `--redactNetworkHeaders` is caught
 * before it leaves the machine.
 *
 * Nothing is mocked, and nothing here touches the database.
 */

/** `apps/api`, which every scanned path is relative to. */
const API_ROOT = path.resolve(import.meta.dir, "..");
/** The repository root, which every config path is relative to. */
const REPO_ROOT = path.resolve(API_ROOT, "../..");

/** This file holds every banned form as a fixture, so it is never scanned. */
const SELF = "src/standards-guard.test.ts";

interface SourceRule {
  /** The bullet, in a sentence a failing run can be acted on from. */
  name: string;
  /** The standards file the bullet lives in, under `docs/standards/`. */
  standard: string;
  /** The banned forms. Each is matched against comment-stripped source. */
  forms: RegExp[];
  /** Which files the rule reads, as paths relative to `apps/api`. Every
   *  scanned file when absent. */
  applies?: (file: string) => boolean;
  /** Files where the form is the point rather than a violation. */
  allowed?: string[];
  /** Lines that break the rule, each of which must be caught. */
  catches: string[];
  /** A comment that only mentions the form, and must be ignored. */
  ignores: string;
}

const isTest = (file: string) => file.endsWith(".test.ts");
/** Production code: neither a test nor the helpers under `src/test/`. */
const isProduction = (file: string) =>
  !isTest(file) && !file.startsWith("src/test/");

const ROLE = `["'](?:admin|agent)["']`;
/** A module specifier in an import, a re-export, a dynamic import or a
 *  require — the quote that opens it, so a form can name what follows. */
const SPECIFIER = String.raw`(?:\bfrom|\bimport|\brequire)\s*\(?\s*["']`;

const SOURCE_RULES: SourceRule[] = [
  {
    name: 'Role values read USER_ROLE from @ticket/shared, in tests and fixtures too: no bare "admin" / "agent" in a role field, a comparison, a case, a cast, a two-role list, or an activity fromValue/toValue (a handoff target reads HANDOFF_TARGET)',
    standard: "conventions.md",
    // Where a role is meant, not the word: `asCaller("admin")` and
    // `seedColleagues("admin")` name a test fixture, and `REPLY_ORIGIN.agent`
    // is a different enum, so none of those match.
    forms: [
      new RegExp(String.raw`\brole\s*:\s*${ROLE}`),
      new RegExp(String.raw`\b(?:fromValue|toValue)\s*:\s*${ROLE}`),
      new RegExp(String.raw`[=!]==?\s*${ROLE}`),
      new RegExp(String.raw`${ROLE}\s*[=!]==?`),
      new RegExp(String.raw`\.(?:toBe|toEqual|includes)\(\s*${ROLE}\s*\)`),
      new RegExp(String.raw`\bcase\s+${ROLE}\s*:`),
      new RegExp(String.raw`\bas\s+${ROLE}`),
      new RegExp(String.raw`\[\s*${ROLE}\s*,\s*${ROLE}\s*\]`),
    ],
    catches: [
      `const stop = subscribe({ role: "admin", send, close });`,
      `{ action: "role_changed", fromValue: "agent", toValue: "admin" },`,
      `if (session.user.role !== "admin") return;`,
      `expect(body.role).toBe("agent");`,
      `case "admin":`,
      `const r = value as "admin" | "agent";`,
      `roles: ["admin", "agent"],`,
    ],
    ignores: `// Values are bare: \`toValue: "admin"\`, not "Role: admin".`,
  },
  {
    name: "Structured output goes through generateText + Output.object, never generateObject (it omits timeout)",
    standard: "ai-features.md",
    // The identifier anywhere in code — the import, the call, an aliased
    // import. Comments are already blanked, and the name means nothing else.
    forms: [/\bgenerateObject\b/],
    catches: [
      `import { generateObject, Output } from "ai";`,
      `const { object } = await generateObject({ model, schema });`,
    ],
    ignores: `// \`Output.object\` rather than \`generateObject\`, which omits \`timeout\`.`,
  },
  {
    name: "The SDK's LanguageModelUsage and the usage fields are read only in ai/provider.ts: callers ask usdFor / wasCached (ADR-0018)",
    standard: "ai-features.md",
    // Tests build SDK-shaped fixtures and assert the mapped fields, which is
    // what checking the seam takes; the rule is about production code.
    forms: [
      /\bLanguageModelUsage\b/,
      /\.(?:inputTokens|outputTokens|totalTokens|reasoningTokens|cachedInputTokens|inputTokenDetails|outputTokenDetails|cacheReadTokens)\b/,
    ],
    applies: isProduction,
    allowed: ["src/ai/provider.ts"],
    catches: [
      `import type { LanguageModelUsage } from "ai";`,
      `const hit = (result.usage?.cachedInputTokens ?? 0) > 0;`,
      `const cached = usage.inputTokenDetails.cacheReadTokens;`,
    ],
    ignores: `// Was \`(result.usage?.cachedInputTokens ?? 0) > 0\`, inline.`,
  },
  {
    name: "The generated Prisma client is imported only by ./db and the test Postgres module; everything else imports the singleton from ./db",
    standard: "backend.md",
    forms: [new RegExp(String.raw`${SPECIFIER}[^"'\n]*generated/prisma\b`)],
    allowed: ["src/db.ts", "src/test/pg.ts"],
    catches: [
      `import { PrismaClient } from "../generated/prisma/client";`,
      `export type { User } from "./generated/prisma/models";`,
      `const { Prisma } = await import("../../generated/prisma/client");`,
    ],
    ignores: `// Import the singleton from ./db, not from "./generated/prisma/client".`,
  },
  {
    name: "postmark is imported only by mail/transport.ts: every email goes through the outbox (ADR-0009)",
    standard: "backend.md",
    forms: [new RegExp(String.raw`${SPECIFIER}postmark(?:/[^"'\n]*)?["']`)],
    allowed: ["src/mail/transport.ts"],
    catches: [
      `import { ServerClient } from "postmark";`,
      `const postmark = await import("postmark");`,
    ],
    ignores: `// The only module that will ever import "postmark" is mail/transport.ts.`,
  },
  {
    name: "No test file registers ../db or ../middleware/auth with mock.module: the preload binds the database and the session seam once",
    standard: "testing-api.md",
    forms: [/\bmock\.module\(\s*["'](?:\.{1,2}\/)+(?:db|middleware\/auth)["']/],
    allowed: ["src/test/preload.ts"],
    catches: [
      `mock.module("../db", () => ({ Prisma, prisma }));`,
      `mock.module("../../middleware/auth", () => stub);`,
    ],
    ignores: `/** Not \`mock.module("../db", …)\`: the preload already bound it. */`,
  },
];

/** Every `.ts` file the guard reads, relative to `apps/api`: `src/` less the
 *  generated client, the seed scripts under `prisma/`, and `prisma.config.ts`. */
function sourceFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(path.join(API_ROOT, dir), {
      withFileTypes: true,
    })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (rel !== "src/generated") walk(rel);
      } else if (entry.name.endsWith(".ts")) files.push(rel);
    }
  };
  walk("src");
  for (const entry of readdirSync(path.join(API_ROOT, "prisma"))) {
    if (entry.endsWith(".ts")) files.push(`prisma/${entry}`);
  }
  files.push("prisma.config.ts");
  return files.filter((file) => file !== SELF);
}

/** The 1-based line numbers in `code` where any of the rule's forms matches,
 *  each once however many forms match it. */
function offendingLines(rule: SourceRule, code: string): number[] {
  const lines = new Set<number>();
  for (const form of rule.forms) {
    // The form's own flags kept: a `/u` or `/i` form must not lose them here.
    const global = new RegExp(form.source, `${form.flags.replace("g", "")}g`);
    for (const match of code.matchAll(global)) {
      lines.add(code.slice(0, match.index).split("\n").length);
    }
  }
  return [...lines].sort((a, b) => a - b);
}

const label = (rule: { name: string; standard: string }) =>
  `${rule.name} (docs/standards/${rule.standard})`;

const FILES = sourceFiles();
const CODE = new Map(
  FILES.map((file) => [
    file,
    stripComments(readFileSync(path.join(API_ROOT, file), "utf8")),
  ]),
);

test("the guard reads the tree it means to", () => {
  // Guard against every rule passing because the directory moved: an empty
  // walk is a green run that checked nothing.
  expect(FILES.length).toBeGreaterThan(100);
  expect(FILES).toContain("src/index.ts");
  expect(FILES).toContain("src/ai/provider.ts");
  expect(FILES).toContain("prisma/seed.ts");
  expect(FILES.some(isTest)).toBe(true);
  expect(FILES.some((file) => file.startsWith("src/generated/"))).toBe(false);
});

for (const rule of SOURCE_RULES) {
  describe(`${rule.standard}: ${rule.name}`, () => {
    test("holds across apps/api", () => {
      const offenders: string[] = [];
      for (const file of FILES) {
        if (rule.applies?.(file) === false || rule.allowed?.includes(file)) {
          continue;
        }
        for (const line of offendingLines(rule, CODE.get(file)!)) {
          offenders.push(`${file}:${line} breaks: ${label(rule)}`);
        }
      }
      expect(offenders).toEqual([]);
    });

    test("its allowlist names files that exist", () => {
      // A renamed exemption would leave the rule guarding nothing there and
      // failing nothing, which reads exactly like a clean tree.
      for (const file of rule.allowed ?? []) expect(FILES).toContain(file);
    });

    test.each(rule.catches)("catches %s", (line) => {
      expect(offendingLines(rule, stripComments(line))).toEqual([1]);
    });

    test("ignores a comment that only mentions the form", () => {
      expect(offendingLines(rule, stripComments(rule.ignores))).toEqual([]);
    });
  });
}

/* ── Repo config ─────────────────────────────────────────────────────────── */

/** The files a config rule reads, by repo-relative path. */
type Files = Record<string, string>;

interface ConfigRule {
  name: string;
  standard: string;
  /** Repo-relative paths, or a directory whose `.md` files are all read. */
  read: () => Files;
  /** What is wrong with these files; empty when the rule holds. */
  problems: (files: Files) => string[];
  /** File sets that break the rule, each of which must be caught. */
  catches: Files[];
  /** A set that only mentions the form where it does not count, and must
   *  pass. */
  ignores?: Files;
}

const readRepo = (...paths: string[]): Files =>
  Object.fromEntries(
    paths.map((p) => [p, readFileSync(path.join(REPO_ROOT, p), "utf8")]),
  );

const API_MANIFEST = "apps/api/package.json";
const WEB_MANIFEST = "apps/web/package.json";
const AGENTS_DIR = ".claude/agents";
const READ_ONLY_AGENTS = [
  "bulk-reader",
  "boilerplate-scribe",
  "security-reviewer",
];

/** `better-auth`'s declared range in a manifest, from whichever block has it. */
function betterAuthRange(manifest: string): string | undefined {
  const json = JSON.parse(manifest) as Record<
    string,
    Record<string, string> | undefined
  >;
  return (
    json.dependencies?.["better-auth"] ?? json.devDependencies?.["better-auth"]
  );
}

/** The YAML frontmatter of a markdown file — the lines between the opening
 *  `---` and the next one — or `""` when it has none. */
function frontmatter(markdown: string): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
  return match?.[1] ?? "";
}

const agentName = (markdown: string) =>
  /^name:\s*["']?([^"'\r\n]+?)["']?\s*$/m.exec(frontmatter(markdown))?.[1];

const AGENT = (name: string, extra = "") =>
  `---\nname: "${name}"\nmodel: haiku\ntools: Read, Glob, Grep\n${extra}---\n\nBody.\n`;

const CONFIG_RULES: ConfigRule[] = [
  {
    name: "better-auth is pinned to an exact version, no ^ or ~, in both apps' manifests, and the two agree",
    standard: "backend.md",
    read: () => readRepo(API_MANIFEST, WEB_MANIFEST),
    problems: (files) => {
      const found: string[] = [];
      const ranges = [API_MANIFEST, WEB_MANIFEST].map((manifest) => {
        const range = betterAuthRange(files[manifest]!);
        if (range === undefined)
          found.push(`${manifest} declares no better-auth`);
        else if (!/^\d+\.\d+\.\d+$/.test(range)) {
          found.push(
            `${manifest} has better-auth "${range}", not an exact version`,
          );
        }
        return range;
      });
      if (ranges[0] !== ranges[1]) {
        found.push(`the apps disagree: ${ranges[0]} and ${ranges[1]}`);
      }
      return found;
    },
    catches: [
      {
        [API_MANIFEST]: `{ "dependencies": { "better-auth": "^1.6.13" } }`,
        [WEB_MANIFEST]: `{ "dependencies": { "better-auth": "1.6.13" } }`,
      },
      {
        [API_MANIFEST]: `{ "dependencies": { "better-auth": "1.6.13" } }`,
        [WEB_MANIFEST]: `{ "dependencies": { "better-auth": "~1.6.13" } }`,
      },
      {
        [API_MANIFEST]: `{ "dependencies": { "better-auth": "1.6.13" } }`,
        [WEB_MANIFEST]: `{ "dependencies": { "better-auth": "1.6.22" } }`,
      },
    ],
  },
  {
    name: ".mcp.json keeps --redactNetworkHeaders on the chrome-devtools server: sessions are cookies, and the network tools would otherwise pull one into the transcript",
    standard: "conventions.md",
    read: () => readRepo(".mcp.json"),
    problems: (files) => {
      const json = JSON.parse(files[".mcp.json"]!) as {
        mcpServers?: Record<string, { args?: string[] } | undefined>;
      };
      const server = json.mcpServers?.["chrome-devtools"];
      if (!server) return [".mcp.json has no chrome-devtools server"];
      return server.args?.includes("--redactNetworkHeaders")
        ? []
        : ["chrome-devtools runs without --redactNetworkHeaders"];
    },
    catches: [
      {
        ".mcp.json": `{ "mcpServers": { "chrome-devtools": { "args": ["chrome-devtools-mcp", "--isolated"] } } }`,
      },
      {
        // Named in another server's args is not the chrome-devtools server
        // having it.
        ".mcp.json": `{ "mcpServers": { "chrome-devtools": { "args": [] }, "other": { "args": ["--redactNetworkHeaders"] } } }`,
      },
    ],
  },
  {
    name: "The read-only agents (bulk-reader, boilerplate-scribe, security-reviewer) declare no memory: — a memory scope silently re-adds Read, Write and Edit",
    standard: "conventions.md",
    read: () =>
      readRepo(
        ...readdirSync(path.join(REPO_ROOT, AGENTS_DIR))
          .filter((entry) => entry.endsWith(".md"))
          .map((entry) => `${AGENTS_DIR}/${entry}`),
      ),
    problems: (files) => {
      const found: string[] = [];
      // By the `name:` in the frontmatter, which is what the Agent tool calls
      // it — `security-reviewer` lives in `security-vulnerability-auditor.md`.
      for (const name of READ_ONLY_AGENTS) {
        const entry = Object.entries(files).find(
          ([, markdown]) => agentName(markdown) === name,
        );
        if (!entry) found.push(`no agent named ${name} in ${AGENTS_DIR}`);
        else if (/^memory\s*:/m.test(frontmatter(entry[1]))) {
          found.push(`${entry[0]} (${name}) declares memory:`);
        }
      }
      return found;
    },
    catches: [
      {
        "a.md": AGENT("bulk-reader", "memory: project\n"),
        "b.md": AGENT("boilerplate-scribe"),
        "c.md": AGENT("security-reviewer"),
      },
      {
        // An agent renamed away is the rule guarding nothing.
        "a.md": AGENT("bulk-reader"),
        "b.md": AGENT("boilerplate-scribe"),
      },
    ],
    ignores: {
      // The body may explain the rule, and a writing agent may keep memory.
      "a.md": `${AGENT("bulk-reader")}memory: project is what not to add.\n`,
      "b.md": AGENT("boilerplate-scribe"),
      "c.md": AGENT("security-reviewer"),
      "d.md": AGENT("playwright-e2e-author", "memory: project\n"),
    },
  },
];

for (const rule of CONFIG_RULES) {
  describe(`${rule.standard}: ${rule.name}`, () => {
    test("holds in the repo", () => {
      expect(
        rule
          .problems(rule.read())
          .map((problem) => `${problem} breaks: ${label(rule)}`),
      ).toEqual([]);
    });

    test.each(rule.catches.map((files, i) => [i + 1, files] as const))(
      "catches planted violation %d",
      (_, files) => {
        expect(rule.problems(files).length).toBeGreaterThan(0);
      },
    );

    if (rule.ignores) {
      const ignores = rule.ignores;
      test("ignores a mention where it does not count", () => {
        expect(rule.problems(ignores)).toEqual([]);
      });
    }
  });
}
