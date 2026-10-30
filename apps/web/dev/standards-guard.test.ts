import { describe, expect, test } from "vitest";
import path from "node:path";
import { partialCheckout } from "@ticket/repo-scan/checkout";
import { checkRules, type Rule, ruleCode } from "@ticket/repo-scan/rules";
import {
  key,
  literal,
  NOT_QUOTE,
  OPENS_LITERAL,
  QUOTE,
} from "@ticket/repo-scan/spellings";
import { trackedFiles } from "@ticket/repo-scan/tracked-files";

/**
 * The frontend standards a check can decide without judgement, enforced here
 * rather than left to whoever reads the diff (#390).
 *
 * Built the way `apps/api/src/jobs/boss.test.ts` guards the jobs directory: read
 * the source tree, fail on a banned pattern. Every rule names the standards file
 * its bullet lives in, and that bullet says this file holds it — so a reader of
 * either knows the other exists. The API's rules, and the repo-wide config
 * ones, are `apps/api/src/standards-guard.test.ts` (#391).
 *
 * **Each rule matches a form, not a word.** `boss.test.ts` bans `.work(` and
 * `retryLimit:` rather than the bare names, and this file does the same for the
 * same reason: the source here explains itself at length, and several files
 * already say *why* there is no `<select>` or `dangerouslySetInnerHTML` in them.
 * Matching runs over `stripComments`' output — `@ticket/repo-scan`'s scanner,
 * which the project map, the API's guard and the doc citations read too, and
 * which blanks comments and keeps strings — so an explanation never fails the
 * build. Each rule is shown a violation it must catch and a comment it must
 * ignore, and may also be shown legitimate lines it must pass. The rule shape
 * and the runner that turns the table into those tests are
 * `@ticket/repo-scan/rules`, which the API guard hands its own table to (#567).
 *
 * Each rule names its roots (#568): the web workspace's own code — `src/` and
 * `dev/` — and, for the role-literal rule and the bare `@ticket/shared` import
 * (#579), the Playwright specs and helpers under `tests/e2e` too (#393); the
 * spec's `ROUTE` rule reads only `tests/e2e`. The others govern how the app is
 * built — its controls, its data fetching, its tokens — and a spec drives the
 * built app rather than being part of it. None reaches `packages/` or `scripts/`,
 * which hold no UI; the API guard's rules are the ones that do. Every file is
 * one git tracks (`trackedFiles`, #567), so a local run checks what CI checks.
 */

/** The repository root, which every path here is relative to. */
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const SRC = "apps/web/src";
const DEV = "apps/web/dev";
/** The web workspace's own code, which every rule here reads. */
const APP = [SRC, DEV];
const E2E = "tests/e2e";

/** This file holds every banned form as a fixture, so it is never scanned. */
const SELF = `${DEV}/standards-guard.test.ts`;

const isTest = (file: string) => /\.test\.tsx?$/.test(file);
const ROLE = literal("admin", "agent");
/** A module specifier in an import, a re-export, a dynamic import, a require
 *  or a test's registration: the quote that opens it. */
const SPECIFIER_OR_MOCK = String.raw`(?:\bfrom|\bimport|\brequire|\bmock\.module|\bvi\.mock)\s*\(?\s*${QUOTE}`;

/** The rules. Each one's `roots`, `applies` and `allowed` name paths from the
 *  repository root. */
const RULES: Rule[] = [
  {
    name: "A route's path is declared once, in ROUTE: navigate(), <Navigate to>, <Link to>, a pathname comparison, an assignment to location.href or window.location, and location.assign()/replace() read ROUTE.<name>.path or ticketDetailPath, never a path literal",
    standard: "frontend.md",
    roots: [SRC],
    // A quoted literal, or a template that does not start by reading something
    // — `${ROUTE.tickets.path}?status=…` is the record plus a query.
    forms: [
      // `useNavigate()`'s function, not `router.navigate(…)`, which a test may
      // drive by URL.
      new RegExp(String.raw`(?<![\w$.])navigate\(\s*${OPENS_LITERAL}`),
      // `[^<]`, not `[^<>]`: an arrow-function handler before `to=` has a `>`.
      new RegExp(
        String.raw`<(?:Navigate|Link|NavLink)\b[^<]*?\bto=\{?\s*${OPENS_LITERAL}`,
      ),
      new RegExp(
        String.raw`<(?:Navigate|Link|NavLink)\b[^<]*?\bto=\{\{\s*pathname:\s*${OPENS_LITERAL}`,
      ),
      new RegExp(String.raw`\bpathname\s*[=!]==\s*${OPENS_LITERAL}`),
      /(?:["']|`)\s*[=!]==\s*(?:[\w$]+\.)*pathname\b/,
      // A full-page navigation (#544): `window.location.href = "/"` reached
      // develop in #521 because no form above reads it. `=(?!=)` leaves a
      // comparison alone. A bare `location =` is not read: it is also how a
      // local is declared.
      new RegExp(
        String.raw`(?:(?<![\w$.])window\.location|(?<![\w$])location\.href)\s*=(?!=)\s*${OPENS_LITERAL}`,
      ),
      new RegExp(
        String.raw`(?<![\w$])location\.(?:assign|replace)\(\s*${OPENS_LITERAL}`,
      ),
    ],
    // Client routes live in `src/`; the node half under `dev/` answers server
    // paths (`/health`). `src/test/` exercises the router helper with synthetic
    // routes of its own, which by construction are not in the app's record.
    applies: (file) => !file.startsWith(`${SRC}/test/`),
    catches: [
      `navigate("/", { replace: true });`,
      `<Link onClick={() => track()} to="/tickets">`,
      `<Navigate to={{ pathname: "/login" }} />`,
      `if (location.pathname === "/tickets") return;`,
      `window.location.href = "/";`,
      `location.href = \`/tickets\`;`,
      `window.location = "/";`,
      `window.location.assign("/login");`,
      `location.replace('/');`,
    ],
    passes: [
      `window.location.href = ROUTE.dashboard.path;`,
      `window.location.assign(ROUTE.login.path);`,
      `location.replace(\`\${ROUTE.tickets.path}?status=open\`);`,
      `expect(location.href).toBe(ROUTE.dashboard.path);`,
    ],
    ignores: `// This used to be \`<Navigate to="/" replace />\`.`,
  },
  {
    name: "A spec navigates by ROUTE too: page.goto(), toHaveURL() and waitForURL() read ROUTE.<name>.path or ticketDetailPath, never a path literal",
    standard: "conventions.md",
    // The specs read the app's own record, which is import-free so they can,
    // and a path that changes there moves them with it rather than landing
    // them on the 404 — or, for an assertion, waiting out its timeout on a
    // URL the app no longer has. An absolute URL the test was handed — an
    // invitation link — is a variable, not a literal, and passes; so does a
    // regex, which matches a shape (`/page=2/`) rather than naming a route.
    roots: [E2E],
    forms: [
      new RegExp(
        String.raw`\.(?:goto|toHaveURL|waitForURL)\(\s*${OPENS_LITERAL}`,
      ),
    ],
    catches: [
      `await page.goto("/tickets");`,
      `await page.goto(\`/tickets/\${id}\`);`,
      `await page.goto(\n  "/?range=7d",\n);`,
      `await expect(page).toHaveURL("/login");`,
      `await expect(page).not.toHaveURL("/login");`,
      `await page.waitForURL("/");`,
    ],
    passes: [
      `await page.goto(ROUTE.tickets.path);`,
      `await page.goto(ticketDetailPath(id));`,
      `await page.goto(\`\${ROUTE.dashboard.path}?range=7d\`);`,
      `await page.goto(link);`,
      `await expect(page).toHaveURL(ROUTE.login.path);`,
      `await expect(page).toHaveURL(/page=2/);`,
      `await page.waitForURL(ticketDetailPath(id));`,
    ],
    ignores: `// This used to be \`page.goto("/tickets")\`.`,
  },
  {
    name: "UI controls come from shadcn/ui: no native <select>, checkbox or radio outside src/components/ui/",
    standard: "frontend.md",
    roots: APP,
    forms: [
      /<select[\s>/]/,
      new RegExp(
        String.raw`<input\b[^<]*?\btype=\{?\s*${literal("checkbox", "radio")}`,
      ),
    ],
    applies: (file) => !file.startsWith(`${SRC}/components/ui/`),
    catches: [
      `<select value={v}>`,
      `<input onChange={(e) => set(e.target.checked)} type="checkbox" />`,
      `<input type={"radio"} name="size" />`,
    ],
    ignores: `/** shadcn's \`Select\`, not a native \`<select>\` or \`<input type="radio">\`. */`,
  },
  {
    name: "Never render email HTML: dangerouslySetInnerHTML appears only in the shadcn chart component",
    standard: "security.md",
    roots: APP,
    forms: [/\bdangerouslySetInnerHTML\s*[=:]/],
    allowed: [`${SRC}/components/ui/chart.tsx`],
    catches: [`<div dangerouslySetInnerHTML={{ __html: html }} />`],
    ignores: `{/* Plain text in a text node, never \`dangerouslySetInnerHTML={…}\`. */}`,
  },
  {
    name: "Data fetching goes through the shared axios instance in @/lib/api: no direct fetch(",
    standard: "frontend.md",
    roots: APP,
    // Not `prefetch(` or `refetch(`, which are react-query's, and not
    // `fetchQuery(`, which is a different word.
    forms: [/(?<![\w$])fetch\s*\(/],
    catches: [`const res = await fetch("/api/tickets");`],
    ignores: `// Don't use fetch() directly.`,
  },
  {
    name: "Anything spawned from the dev server is asynchronous: no execFileSync, spawnSync or execSync under dev/",
    standard: "dev-tools.md",
    roots: [DEV],
    // The identifier anywhere in code: the call, the import, an aliased import
    // (`execFileSync as run`, which a call-form match missed when planted), a
    // `child_process.spawnSync` member read. Comments are already blanked, and
    // the names mean nothing else.
    forms: [/\b(?:execFileSync|spawnSync|execSync)\b/],
    catches: [
      `import { execFileSync as run } from "node:child_process";`,
      `const out = child_process.spawnSync("gh", args);`,
    ],
    ignores: `/** \`execFileSync\` in a middleware is wrong twice over: execFileSync(…) */`,
  },
  {
    name: "Temper blue as text is text-link, not text-primary (text-primary-foreground is fine)",
    standard: "frontend.md",
    roots: APP,
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
    roots: APP,
    forms: [/prefers-reduced-motion/],
    allowed: [`${SRC}/lib/use-reduced-motion.ts`, `${SRC}/test/setup.ts`],
    catches: [`window.matchMedia("(prefers-reduced-motion: reduce)")`],
    ignores: `/** The test setup answers \`matches: true\` to \`prefers-reduced-motion\`. */`,
  },
  {
    name: 'Role values read USER_ROLE from @ticket/shared: no bare "admin" / "agent" in a role field, a comparison, a case, a cast, a two-role list, a signIn() or getByText() argument, or an activity fromValue/toValue (a handoff target reads HANDOFF_TARGET)',
    standard: "conventions.md",
    // The Playwright specs drive the API and assert on its answers, so they
    // write role values as often as the app does (#393).
    roots: [...APP, E2E],
    forms: [
      new RegExp(`${key("role", "fromValue", "toValue")}\\s*${ROLE}`),
      new RegExp(`[=!]==?\\s*${ROLE}`),
      new RegExp(`${ROLE}\\s*[=!]==?`),
      new RegExp(`\\.(?:toBe|toEqual|includes)\\(\\s*${ROLE}\\s*\\)`),
      new RegExp(`\\bcase\\s+${ROLE}\\s*:`),
      // An inline cast, and the union spelled out as a list — conventions.md
      // bans both by name.
      new RegExp(`\\bas\\s+${ROLE}`),
      new RegExp(`\\[\\s*${ROLE}\\s*,\\s*${ROLE}\\s*\\]`),
      // The e2e `signIn(page, role)` helper takes a `UserRole`, unlike the
      // API's `asCaller` fixture keys, and the users page prints the bare role
      // value in its badge, so a query for that badge is one too.
      new RegExp(`\\bsignIn\\(\\s*[\\w$.]+\\s*,\\s*${ROLE}`),
      new RegExp(`\\.getByText\\(\\s*${ROLE}`),
    ],
    catches: [
      `const ADMIN = { name: "Aaron", role: "admin" };`,
      `if (user.role === "agent") return;`,
      `expect(body.role).toBe("admin");`,
      `case "agent":`,
      `const r = value as "admin" | "agent";`,
      `roles: ["admin", "agent"],`,
      `await signIn(page, "agent");`,
      `await expect(row.getByText("admin", { exact: true })).toBeVisible();`,
    ],
    passes: [
      `await signIn(page, USER_ROLE.admin);`,
      `await expect(row.getByText("Admin", { exact: true })).toBeVisible();`,
    ],
    ignores: `// a placeholder span instead of a button for role === "admin".`,
  },
  {
    name: "Callers import the bare @ticket/shared: never a subpath, nor a shared file by path, which a test's registration of @ticket/shared does not reach",
    standard: "conventions.md",
    // The specs import the package's vocabulary as the app does (#579).
    roots: [...APP, E2E],
    forms: [
      new RegExp(String.raw`${SPECIFIER_OR_MOCK}@ticket/shared/`),
      new RegExp(
        String.raw`${SPECIFIER_OR_MOCK}${NOT_QUOTE}*\b(?:packages/shared|shared/src)(?=[/"'\`])`,
      ),
    ],
    catches: [
      `import { TICKET_STATUS } from "@ticket/shared/tickets";`,
      `import { USER_ROLE } from "../../packages/shared/src/index";`,
      `vi.mock("@ticket/shared/src/changelog.ts", () => stub);`,
    ],
    passes: [
      `import { USER_ROLE } from "@ticket/shared";`,
      `import { stripComments } from "@ticket/repo-scan/strip-comments";`,
    ],
    ignores: `// Import "@ticket/shared", never "@ticket/shared/changelog".`,
  },
];

// The develop image has no `.git` or `git`, so there nothing is read and every
// check over the tree skips; the rules' own examples skip with them.
const CODE = ruleCode(RULES, {
  root: REPO_ROOT,
  skip: [SELF],
  tracked: partialCheckout ? [] : trackedFiles(REPO_ROOT),
});

test.skipIf(partialCheckout)("the guard reads the tree it means to", () => {
  // Guard against every rule passing because the directory moved: an empty
  // list is a green run that checked nothing. Each rule's own roots check
  // asks the same of every root it names.
  const files = [...CODE.keys()];
  expect(
    files.filter((file) => !file.startsWith(`${E2E}/`)).length,
  ).toBeGreaterThan(100);
  expect(files).toContain(`${SRC}/App.tsx`);
  expect(files).toContain(`${DEV}/scan.ts`);
  expect(files.some(isTest)).toBe(true);
  expect(files).toContain(`${E2E}/users-api.spec.ts`);
  expect(files).toContain(`${E2E}/helpers/auth.ts`);
});

checkRules(RULES, CODE, {
  describe,
  test: test.skipIf(partialCheckout),
  expect,
});
