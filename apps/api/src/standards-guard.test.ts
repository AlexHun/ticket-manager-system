import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { BRAND_ATTRIBUTIVE, BRAND_NAME, BRAND_SHORT } from "@ticket/shared";
import {
  checkRules,
  type Rule,
  ruleCode,
  ruleLabel,
  underAny,
} from "@ticket/repo-scan/rules";
import { filesUnder, trackedFiles } from "@ticket/repo-scan/tracked-files";

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
 * source (`stripComments`, from `@ticket/repo-scan`), so an explanation never
 * fails the build, and each rule is shown a violation it must catch and a
 * comment it must ignore. The rule shape and the runner that turns the table
 * into tests are `@ticket/repo-scan/rules`, which the web guard hands its own
 * table to (#567).
 *
 * **Every rule here reads the files git tracks** (`trackedFiles`, #567), the
 * config rules included, so a local run checks what CI checks, and nothing
 * generated or ignored needs excluding by name. Each source rule names the
 * roots it reads (#568), and `ruleCode` reads every tracked source file under
 * them.
 *
 * **The repo-wide config rules live here rather than in the web guard** because
 * this suite runs on pre-push as well as in CI, and the web suite only in CI:
 * a widened `better-auth` pin or a dropped `--redactNetworkHeaders` is caught
 * before it leaves the machine. So does the product-name rule (#545), which
 * reads raw text, comments included, across both apps, `packages/` but
 * `packages/shared` and `scripts/`, rather than one workspace's stripped
 * source.
 *
 * Nothing is mocked, and nothing here touches the database.
 */

/** The repository root, which every path here is relative to. */
const REPO_ROOT = path.resolve(import.meta.dir, "../../..");

/** This file holds every banned form as a fixture, so it is never scanned. */
const SELF = "apps/api/src/standards-guard.test.ts";

/** The API's own code: `src/`, the seed scripts in `prisma/`, and
 *  `prisma.config.ts`. The generated client is not tracked, so it is not
 *  read. */
const API = ["apps/api/src", "apps/api/prisma", "apps/api/prisma.config.ts"];
/** The API's code, `packages/` and `scripts/` (#568). `packages/shared` is
 *  read too: `USER_ROLE` is defined there as a map, which no role form
 *  matches. `tools/` is the scanner itself, and the web guard's rules read the
 *  web workspace. */
const API_PACKAGES_SCRIPTS = [...API, "packages", "scripts"];

const isTest = (file: string) => /\.test\.[cm]?[jt]sx?$/.test(file);
/** Production code: neither a test nor the helpers under `src/test/`. */
const isProduction = (file: string) =>
  !isTest(file) && !file.startsWith("apps/api/src/test/");

const ROLE = "[\"'`](?:admin|agent)[\"'`]";
/** The fields a role is written into: the user's own, and the two sides of a
 *  `role_changed` activity row. */
const ROLE_KEY = String.raw`\b(?:role|fromValue|toValue)`;
/** A module specifier in an import, a re-export, a dynamic import or a
 *  require — the quote that opens it, so a form can name what follows. */
const SPECIFIER = String.raw`(?:\bfrom|\bimport|\brequire)\s*\(?\s*["']`;
/** A field of the SDK's usage object or of `AiUsage`, as a whole word. */
const USAGE_FIELD = String.raw`(?:inputTokens|outputTokens|totalTokens|reasoningTokens|cachedInputTokens|inputTokenDetails|outputTokenDetails|cacheReadTokens)\b`;

/** The source rules. Each rule's `roots`, `applies` and `allowed` name paths
 *  from the repository root. */
const SOURCE_RULES: Rule[] = [
  {
    name: 'Role values read USER_ROLE from @ticket/shared, in tests and fixtures too: no bare "admin" / "agent" in a role field, a comparison, a case, a cast, a two-role list, or an activity fromValue/toValue (a handoff target reads HANDOFF_TARGET)',
    standard: "conventions.md",
    roots: API_PACKAGES_SCRIPTS,
    // Where a role is meant, not the word: `asCaller("admin")` and
    // `seedColleagues("admin")` name a test fixture, and `REPLY_ORIGIN.agent`
    // is a different enum, so none of those match. The web guard's forms,
    // plus a quoted or optional key, a backtick literal and an assignment,
    // which review of this file found missing.
    forms: [
      // `role: "admin"`, `"role": "admin"`, `role?: "admin"`.
      new RegExp(String.raw`${ROLE_KEY}["']?\s*\??\s*:\s*${ROLE}`),
      new RegExp(String.raw`${ROLE_KEY}\s*=(?!=)\s*${ROLE}`),
      // Anything typed as a role and given a literal: `let r: UserRole = "agent"`.
      new RegExp(String.raw`:\s*UserRole\s*=(?!=)\s*${ROLE}`),
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
      `const body = JSON.stringify({ "role": "admin" });`,
      `type Caller = { role?: "agent" };`,
      `function seed(role = \`admin\`) {}`,
      `let fallback: UserRole = "agent";`,
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
    roots: API_PACKAGES_SCRIPTS,
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
    roots: API_PACKAGES_SCRIPTS,
    // Tests build SDK-shaped fixtures and assert the mapped fields, which is
    // what checking the seam takes; the rule is about production code.
    forms: [
      /\bLanguageModelUsage\b/,
      new RegExp(String.raw`\.${USAGE_FIELD}`),
      new RegExp(String.raw`\[\s*["'\`]${USAGE_FIELD}["'\`]\s*\]`),
      // A destructuring read: `const { cachedInputTokens } = usage`.
      new RegExp(
        String.raw`\b(?:const|let|var)\s*\{[^}]*${USAGE_FIELD}[^}]*\}\s*=`,
      ),
    ],
    applies: isProduction,
    allowed: ["apps/api/src/ai/provider.ts"],
    catches: [
      `import type { LanguageModelUsage } from "ai";`,
      `const hit = (result.usage?.cachedInputTokens ?? 0) > 0;`,
      `const cached = usage.inputTokenDetails.cacheReadTokens;`,
      `const reasoning = usage["reasoningTokens"];`,
      `const { inputTokens, outputTokens } = result.usage!;`,
    ],
    ignores: `// Was \`(result.usage?.cachedInputTokens ?? 0) > 0\`, inline.`,
  },
  {
    name: "The generated Prisma client is imported only by ./db and the test Postgres module; everything else imports the singleton from ./db",
    standard: "backend.md",
    roots: API_PACKAGES_SCRIPTS,
    forms: [new RegExp(String.raw`${SPECIFIER}[^"'\n]*generated/prisma\b`)],
    allowed: ["apps/api/src/db.ts", "apps/api/src/test/pg.ts"],
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
    roots: API_PACKAGES_SCRIPTS,
    forms: [new RegExp(String.raw`${SPECIFIER}postmark(?:/[^"'\n]*)?["']`)],
    allowed: ["apps/api/src/mail/transport.ts"],
    catches: [
      `import { ServerClient } from "postmark";`,
      `const postmark = await import("postmark");`,
    ],
    ignores: `// The only module that will ever import "postmark" is mail/transport.ts.`,
  },
  {
    name: "No test file registers ../db, ../middleware/auth or the session seam ../middleware/session with mock.module: the preload binds the database and who is asking once",
    standard: "testing-api.md",
    // The API's alone: `../db` and the middleware are its modules, and only
    // its tests run under the preload.
    roots: API,
    // `session` beside the two the bullet names: it is the specifier the
    // preload actually binds for the guards (#366), so a file re-registering
    // it is the per-file default the bullet warns about.
    forms: [
      /\bmock\.module\(\s*["'](?:\.{1,2}\/)+(?:db|middleware\/(?:auth|session))(?:\.ts|\/index(?:\.ts)?)?["']/,
    ],
    allowed: ["apps/api/src/test/preload.ts"],
    catches: [
      `mock.module("../db", () => ({ Prisma, prisma }));`,
      `mock.module("../../middleware/auth", () => stub);`,
      `mock.module("../middleware/session.ts", () => ({ lookupSession }));`,
      `mock.module("./db/index", () => ({}));`,
    ],
    ignores: `/** Not \`mock.module("../db", …)\`: the preload already bound it. */`,
  },
];

/** Every file git tracks, relative to the repository root. */
const TRACKED = trackedFiles(REPO_ROOT);

const CODE = ruleCode(SOURCE_RULES, {
  root: REPO_ROOT,
  skip: [SELF],
  tracked: TRACKED,
});

test("the guard reads the tree it means to", () => {
  // Guard against every rule passing because the directory moved: an empty
  // list is a green run that checked nothing. Each rule's own roots check
  // asks the same of every root it names.
  const files = [...CODE.keys()];
  expect(files.length).toBeGreaterThan(100);
  expect(files).toContain("apps/api/src/index.ts");
  expect(files).toContain("apps/api/src/ai/provider.ts");
  expect(files).toContain("apps/api/prisma/seed.ts");
  expect(files.some(isTest)).toBe(true);
  expect(files.some((file) => file.includes("/generated/"))).toBe(false);
});

checkRules(SOURCE_RULES, CODE, { describe, test, expect });

/* ── Repo config ─────────────────────────────────────────────────────────── */

/** What a config rule reads: each file's text, keyed by repo-relative path. */
type FileContents = Record<string, string>;

interface ConfigRule {
  name: string;
  standard: string;
  /** The rule's files as they are in the repo. */
  read: () => FileContents;
  /** What is wrong with these files; empty when the rule holds. */
  problems: (files: FileContents) => string[];
  /** File sets that break the rule, each of which must be caught. */
  catches: FileContents[];
  /** A set that only mentions the form where it does not count, and must
   *  pass. */
  ignores?: FileContents;
}

const readRepo = (...paths: string[]): FileContents =>
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
  "copy-reviewer",
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

/** The roots the product-name rule reads, repo-relative: both apps, and since
 *  #568 `packages/` and `scripts/`. */
const BRAND_SCOPE = ["apps/api", "apps/web", "packages", "scripts"];
/** Where the name is typed, once, for everything else to read: never read. */
const BRAND_HOME = "packages/shared";
/** The text files a name could be typed into. Not `.env*`: a local env file
 *  holds live secrets, and nothing reads it here. */
const BRAND_FILE =
  /(?:\.(?:ts|tsx|js|mjs|cjs|html|css|json|md|sql|prisma|toml|svg|ya?ml)|^Dockerfile(?:\.\w+)?|^Caddyfile)$/;
/**
 * The product name in any of its lengths, matched over raw text — comments
 * included, unlike the source rules above, because a comment restating the
 * name is how #513's first draft carried it (#545). Built from the words of
 * `BRAND_ATTRIBUTIVE`, so this file never types the name: the last two are
 * `BRAND_SHORT` and in all three constants, the first two in the two longer
 * ones. Case is loose, and so is what joins the words — a
 * space, a line break, a hyphen, an underscore or nothing — so a slug or an
 * identifier that starts with it is still the name. Only the start is a word
 * boundary: one at the end would let `…DeskSignOff` through.
 */
const [BRAND_W1, BRAND_W2, BRAND_W3] = BRAND_ATTRIBUTIVE.split(" ");
const BRAND_FORM = new RegExp(
  String.raw`\b(?:${BRAND_W1}[\s_-]*${BRAND_W2}|${BRAND_W2}[\s_-]*${BRAND_W3})`,
  "gi",
);

/**
 * The files that may type the name, each with how many times and why. A file
 * here is held to exactly that count, so a literal added to it fails as one
 * anywhere else would, and so does one removed, or an allowance whose file
 * moved, rather than guarding nothing.
 */
const BRAND_ALLOWANCES: Record<string, { count: number; reason: string }> = {
  "apps/web/index.html": {
    count: 1,
    reason:
      "the tab title in the static shell is read before any module runs, so it cannot import BRAND_SHORT; tests/e2e/brand.spec.ts holds the two together",
  },
  "apps/api/src/routes/users.test.ts": {
    count: 5,
    reason:
      "pins the invitation and reset emails as the recipient reads them, which an import of the constant would follow anywhere",
  },
};

/**
 * Every tracked text file under `BRAND_SCOPE` and outside `BRAND_HOME`, keyed
 * by repo-relative path.
 * This file is read too: its fixtures build the name from the constants rather
 * than typing it. Tracked files, as the source rules read (#567), so installed,
 * built and generated output is never read and needs no exclusion; an
 * untracked file is read once it is added.
 */
function brandScopeFiles(): FileContents {
  return readRepo(
    ...TRACKED.filter(
      (file) =>
        underAny(BRAND_SCOPE, file) &&
        !underAny([BRAND_HOME], file) &&
        BRAND_FILE.test(file.slice(file.lastIndexOf("/") + 1)),
    ),
  );
}

/** The 1-based line of each place `text` names the product. */
const brandLines = (text: string) =>
  [...text.matchAll(BRAND_FORM)].map(
    (match) => text.slice(0, match.index).split("\n").length,
  );

/** Every allowed file holding exactly its count, which each planted set
 *  starts from so it is caught for the one thing it plants. */
const BRAND_SHELL: FileContents = Object.fromEntries(
  Object.entries(BRAND_ALLOWANCES).map(([file, { count }]) => [
    file,
    `${BRAND_NAME}\n`.repeat(count),
  ]),
);

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
      const args = server.args ?? [];
      // A later `--redactNetworkHeaders=false` would switch it back off.
      return args.includes("--redactNetworkHeaders") &&
        !args.some((arg) => arg.startsWith("--redactNetworkHeaders="))
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
      {
        ".mcp.json": `{ "mcpServers": { "chrome-devtools": { "args": ["--redactNetworkHeaders", "--redactNetworkHeaders=false"] } } }`,
      },
    ],
  },
  {
    name: "The read-only agents (bulk-reader, boilerplate-scribe, security-reviewer, copy-reviewer) declare no memory: — a memory scope silently re-adds Read, Write and Edit",
    standard: "conventions.md",
    read: () =>
      readRepo(
        ...filesUnder(TRACKED, AGENTS_DIR)
          .filter((entry) => /^[^/]+\.md$/.test(entry))
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
        "e.md": AGENT("copy-reviewer"),
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
      "e.md": AGENT("copy-reviewer"),
      "d.md": AGENT("playwright-e2e-author", "memory: project\n"),
    },
  },
  {
    name: "The product name is typed only in @ticket/shared: apps/api, apps/web, packages/ but packages/shared, and scripts/ read BRAND_NAME, BRAND_SHORT or BRAND_ATTRIBUTIVE, comments included, outside the counted allowances in BRAND_ALLOWANCES",
    standard: "copy.md",
    read: brandScopeFiles,
    problems: (files) => {
      const found: string[] = [];
      for (const [file, text] of Object.entries(files)) {
        if (file in BRAND_ALLOWANCES) continue;
        for (const line of brandLines(text)) {
          found.push(`${file}:${line} types the product name`);
        }
      }
      for (const [file, { count, reason }] of Object.entries(
        BRAND_ALLOWANCES,
      )) {
        const lines = brandLines(files[file] ?? "");
        if (lines.length !== count) {
          found.push(
            `${file} is allowed the product name ${count} times (${reason}) and has it ${lines.length} (lines ${lines.join(", ") || "none"})`,
          );
        }
      }
      return found;
    },
    catches: [
      // A comment — the case the source rules' stripping would have missed.
      {
        ...BRAND_SHELL,
        "apps/web/src/components/layout/Lockup.tsx": `/** Reads "${BRAND_NAME}". */\nexport const x = 1;\n`,
      },
      // The short form, broken over a line, in lower case.
      {
        ...BRAND_SHELL,
        "apps/api/src/auth.ts": `const slug = \`${BRAND_SHORT.toLowerCase().replace(" ", "\n  ")}\`;\n`,
      },
      // A hyphenated slug, and an identifier.
      {
        ...BRAND_SHELL,
        "apps/web/src/lib/storage.ts": `const KEY = "${BRAND_SHORT.toLowerCase().replace(" ", "-")}:density";\n`,
      },
      {
        ...BRAND_SHELL,
        "apps/api/src/mail/sign-off.ts": `export const ${BRAND_SHORT.replace(" ", "")}SignOff = 1;\n`,
      },
      // The attributive form, in a test that has no allowance.
      {
        ...BRAND_SHELL,
        "apps/web/src/pages/LoginPage.test.tsx": `expect(subject).toBe("Your ${BRAND_ATTRIBUTIVE} account is ready");\n`,
      },
      // A second literal in an allowed file is over its count.
      {
        ...BRAND_SHELL,
        "apps/web/index.html": `<title>${BRAND_SHORT}</title>\n<meta content="${BRAND_SHORT}" />\n`,
      },
      // An allowance whose file is gone guards nothing.
      {
        "apps/api/src/routes/users.test.ts":
          BRAND_SHELL["apps/api/src/routes/users.test.ts"]!,
      },
    ],
    ignores: {
      ...BRAND_SHELL,
      // Reading the constant is the rule kept; the words apart, or with
      // another word between, are ordinary words.
      "apps/web/src/components/layout/LoginLockup.tsx":
        '// The lockup reads BRAND_NAME; at the desk the agents forge replies.\n<span className="sr-only">{BRAND_NAME}</span>\n',
    },
  },
];

test("the product-name rule reads the tree it means to", () => {
  // An empty list would pass every file it did not read.
  const files = Object.keys(brandScopeFiles());
  expect(files.length).toBeGreaterThan(400);
  expect(files).toContain("apps/api/src/auth.ts");
  expect(files).toContain("apps/web/src/components/layout/LoginLockup.tsx");
  expect(files).toContain("apps/web/index.html");
  expect(files).toContain("packages/core/src/index.ts");
  expect(files).toContain("scripts/graph.ts");
  expect(files.some((file) => file.startsWith(`${BRAND_HOME}/`))).toBe(false);
  // No file is skipped by name: the guard itself is read like any other.
  expect(files).toContain(SELF);
  expect(files.some((file) => file.includes("/node_modules/"))).toBe(false);
});

for (const rule of CONFIG_RULES) {
  describe(`${rule.standard}: ${rule.name}`, () => {
    test("holds in the repo", () => {
      expect(
        rule
          .problems(rule.read())
          .map((problem) => `${problem} breaks: ${ruleLabel(rule)}`),
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
