import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { stripComments } from "./scan.ts";

/**
 * The frontend standards a check can decide without judgement, enforced here
 * rather than left to whoever reads the diff (#390).
 *
 * Built the way `apps/api/src/jobs/boss.test.ts` guards the jobs directory: read
 * the source tree, fail on a banned pattern. Every rule names the standards file
 * its bullet lives in, and that bullet says this file holds it — so a reader of
 * either knows the other exists.
 *
 * **Each rule matches a form, not a word.** `boss.test.ts` bans `.work(` and
 * `retryLimit:` rather than the bare names, and this file does the same for the
 * same reason: the source here explains itself at length, and several files
 * already say *why* there is no `<select>` or `dangerouslySetInnerHTML` in them.
 * Matching runs over `stripComments`' output — the project map's own scanner,
 * which blanks comments and keeps strings — so an explanation never fails the
 * build. The `forms` cases at the bottom hold that for every rule: each one is
 * shown a violation it must catch and a comment it must ignore.
 *
 * Scope is the web workspace's own code — `src/` and `dev/`. The Playwright
 * specs under `tests/e2e` are a different suite and are not read here.
 */

const WEB_ROOT = path.resolve(import.meta.dirname, "..");

/** This file holds every banned form as a fixture, so it is never scanned. */
const SELF = "dev/standards-guard.test.ts";

interface Rule {
  /** The bullet, in a sentence a failing run can be acted on from. */
  name: string;
  /** The standards file the bullet lives in, under `docs/standards/`. */
  standard: string;
  /** The banned forms. Each is matched against comment-stripped source. */
  forms: RegExp[];
  /** Which files the rule reads, as paths relative to `apps/web`. Every
   *  scanned file when absent. */
  applies?: (file: string) => boolean;
  /** Files where the form is the point rather than a violation. */
  allowed?: string[];
  /** Lines that break the rule, each of which must be caught. */
  catches: string[];
  /** A comment that only mentions the form, and must be ignored. */
  ignores: string;
}

const isTest = (file: string) => /\.test\.tsx?$/.test(file);
const ROLE = `["'](?:admin|agent)["']`;

const RULES: Rule[] = [
  {
    name: "A route's path is declared once, in ROUTE: navigate(), <Navigate to>, <Link to> and a pathname comparison read ROUTE.<name>.path or ticketDetailPath, never a path literal",
    standard: "frontend.md",
    // A quoted literal, or a template that does not start by reading something
    // — `${ROUTE.tickets.path}?status=…` is the record plus a query.
    forms: [
      // `useNavigate()`'s function, not `router.navigate(…)`, which a test may
      // drive by URL.
      /(?<![\w$.])navigate\(\s*(?:["']|`(?!\$\{))/,
      // `[^<]`, not `[^<>]`: an arrow-function handler before `to=` has a `>`.
      /<(?:Navigate|Link|NavLink)\b[^<]*?\bto=\{?\s*(?:["']|`(?!\$\{))/,
      /<(?:Navigate|Link|NavLink)\b[^<]*?\bto=\{\{\s*pathname:\s*(?:["']|`(?!\$\{))/,
      /\bpathname\s*[=!]==\s*(?:["']|`(?!\$\{))/,
      /(?:["']|`)\s*[=!]==\s*(?:[\w$]+\.)*pathname\b/,
    ],
    // Client routes live in `src/`; the node half under `dev/` answers server
    // paths (`/health`). `src/test/` exercises the router helper with synthetic
    // routes of its own, which by construction are not in the app's record.
    applies: (file) => file.startsWith("src/") && !file.startsWith("src/test/"),
    catches: [
      `navigate("/", { replace: true });`,
      `<Link onClick={() => track()} to="/tickets">`,
      `<Navigate to={{ pathname: "/login" }} />`,
      `if (location.pathname === "/tickets") return;`,
    ],
    ignores: `// This used to be \`<Navigate to="/" replace />\`.`,
  },
  {
    name: "UI controls come from shadcn/ui: no native <select>, checkbox or radio outside src/components/ui/",
    standard: "frontend.md",
    forms: [
      /<select[\s>/]/,
      /<input\b[^<]*?\btype=\{?\s*["'](?:checkbox|radio)["']/,
    ],
    applies: (file) => !file.startsWith("src/components/ui/"),
    catches: [
      `<select value={v}>`,
      `<input onChange={(e) => set(e.target.checked)} type="checkbox" />`,
    ],
    ignores: `/** shadcn's \`Select\`, not a native \`<select>\` or \`<input type="radio">\`. */`,
  },
  {
    name: "Never render email HTML: dangerouslySetInnerHTML appears only in the shadcn chart component",
    standard: "security.md",
    forms: [/\bdangerouslySetInnerHTML\s*[=:]/],
    allowed: ["src/components/ui/chart.tsx"],
    catches: [`<div dangerouslySetInnerHTML={{ __html: html }} />`],
    ignores: `{/* Plain text in a text node, never \`dangerouslySetInnerHTML={…}\`. */}`,
  },
  {
    name: "Data fetching goes through the shared axios instance in @/lib/api: no direct fetch(",
    standard: "frontend.md",
    // Not `prefetch(` or `refetch(`, which are react-query's, and not
    // `fetchQuery(`, which is a different word.
    forms: [/(?<![\w$])fetch\s*\(/],
    catches: [`const res = await fetch("/api/tickets");`],
    ignores: `// Don't use fetch() directly.`,
  },
  {
    name: "Anything spawned from the dev server is asynchronous: no execFileSync, spawnSync or execSync under dev/",
    standard: "frontend.md",
    // The identifier anywhere in code: the call, the import, an aliased import
    // (`execFileSync as run`, which a call-form match missed when planted), a
    // `child_process.spawnSync` member read. Comments are already blanked, and
    // the names mean nothing else.
    forms: [/\b(?:execFileSync|spawnSync|execSync)\b/],
    applies: (file) => file.startsWith("dev/"),
    catches: [
      `import { execFileSync as run } from "node:child_process";`,
      `const out = child_process.spawnSync("gh", args);`,
    ],
    ignores: `/** \`execFileSync\` in a middleware is wrong twice over: execFileSync(…) */`,
  },
  {
    name: "Temper blue as text is text-link, not text-primary (text-primary-foreground is fine)",
    standard: "frontend.md",
    forms: [/(?<![\w-])text-primary(?![\w-])/],
    catches: [
      `<a className="text-primary hover:underline">`,
      `cn("hover:text-primary/80", cls)`,
    ],
    ignores: `// Was text-primary, a fill at 2.93:1 on the card.`,
  },
  {
    name: "Respect prefers-reduced-motion through useReducedMotion: the media query appears only in that hook and the test setup",
    standard: "frontend.md",
    forms: [/prefers-reduced-motion/],
    allowed: ["src/lib/use-reduced-motion.ts", "src/test/setup.ts"],
    catches: [`window.matchMedia("(prefers-reduced-motion: reduce)")`],
    ignores: `/** The test setup answers \`matches: true\` to \`prefers-reduced-motion\`. */`,
  },
  {
    name: 'Role values read USER_ROLE from @ticket/shared: no bare "admin" / "agent" in a role field, a comparison, a case, a cast, a two-role list, or an activity fromValue/toValue (a handoff target reads HANDOFF_TARGET)',
    standard: "conventions.md",
    forms: [
      new RegExp(`\\brole\\s*:\\s*${ROLE}`),
      new RegExp(`\\b(?:fromValue|toValue)\\s*:\\s*${ROLE}`),
      new RegExp(`[=!]==?\\s*${ROLE}`),
      new RegExp(`${ROLE}\\s*[=!]==?`),
      new RegExp(`\\.(?:toBe|toEqual|includes)\\(\\s*${ROLE}\\s*\\)`),
      new RegExp(`\\bcase\\s+${ROLE}\\s*:`),
      // An inline cast, and the union spelled out as a list — conventions.md
      // bans both by name.
      new RegExp(`\\bas\\s+${ROLE}`),
      new RegExp(`\\[\\s*${ROLE}\\s*,\\s*${ROLE}\\s*\\]`),
    ],
    catches: [
      `const ADMIN = { name: "Aaron", role: "admin" };`,
      `if (user.role === "agent") return;`,
      `expect(body.role).toBe("admin");`,
      `case "agent":`,
      `const r = value as "admin" | "agent";`,
      `roles: ["admin", "agent"],`,
    ],
    ignores: `// a placeholder span instead of a button for role === "admin".`,
  },
];

/** Every `.ts`/`.tsx` file under `src/` and `dev/`, relative to `apps/web`. */
function sourceFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(path.join(WEB_ROOT, dir), {
      withFileTypes: true,
    })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (/\.tsx?$/.test(entry.name)) files.push(rel);
    }
  };
  walk("src");
  walk("dev");
  return files.filter((file) => file !== SELF);
}

/** The 1-based line numbers in `code` where any of the rule's forms matches,
 *  each once however many forms match it. */
function offendingLines(rule: Rule, code: string): number[] {
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

const FILES = sourceFiles();
const CODE = new Map(
  FILES.map((file) => [
    file,
    stripComments(readFileSync(path.join(WEB_ROOT, file), "utf8")).code,
  ]),
);

test("the guard reads the tree it means to", () => {
  // Guard against every rule passing because the directory moved: an empty
  // walk is a green run that checked nothing.
  expect(FILES.length).toBeGreaterThan(100);
  expect(FILES).toContain("src/App.tsx");
  expect(FILES).toContain("dev/scan.ts");
  expect(FILES.some(isTest)).toBe(true);
});

describe.each(RULES)("$standard: $name", (rule) => {
  test("holds across src/ and dev/", () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      if (rule.applies?.(file) === false || rule.allowed?.includes(file)) {
        continue;
      }
      for (const line of offendingLines(rule, CODE.get(file)!)) {
        offenders.push(`${file}:${line}`);
      }
    }
    expect(offenders, `${rule.name} (docs/standards/${rule.standard})`).toEqual(
      [],
    );
  });

  test("its allowlist names files that exist", () => {
    // A renamed exemption would leave the rule guarding nothing there and
    // failing nothing, which reads exactly like a clean tree.
    for (const file of rule.allowed ?? []) expect(FILES).toContain(file);
  });

  test.each(rule.catches)("catches %s", (line) => {
    expect(offendingLines(rule, stripComments(line).code)).toEqual([1]);
  });

  test("ignores a comment that only mentions the form", () => {
    expect(offendingLines(rule, stripComments(rule.ignores).code)).toEqual([]);
  });
});
