import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { TICKET_INPUT_MESSAGE } from "@ticket/shared";
import { stripComments } from "@ticket/repo-scan/strip-comments";

/**
 * Every validation message in `@ticket/core` that a person can see ends in a
 * full stop (#518). `docs/standards/copy.md` makes an API or validation message
 * that reaches the UI copy, "ends in a full stop" included, and none of the
 * zod field messages did. A mechanical rule gets a check rather than a
 * reviewer's eye, so a new message without one fails here.
 *
 * It scans the schema sources rather than walking the exported schemas: zod
 * keeps a message inside a closure on each check, and a walker would have to
 * know every wrapper (`optional`, `default`, `pipe`, `superRefine`) to reach
 * them all. A message is any string literal outside a comment that starts with
 * a capital letter or holds a space; the schemas' other literals are module
 * specifiers, issue codes and field paths ("zod", "custom", "userId"), which
 * are neither.
 */

const REPO_ROOT = path.resolve(import.meta.dir, "../../..");
const SCHEMAS_DIR = path.join(REPO_ROOT, "packages/core/src/schemas");

/** A `"…"`, `'…'` or template literal, matched left to right so a quote of one
 *  kind inside a literal of another stays part of it. */
const LITERAL =
  /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;

/** The literals in `source` that read as a message, with their line numbers. */
function messagesIn(source: string): { text: string; line: number }[] {
  const code = stripComments(source).code;
  const found: { text: string; line: number }[] = [];
  for (const match of code.matchAll(LITERAL)) {
    const text = match[1] ?? match[2] ?? match[3] ?? "";
    if (!/^[A-Z]/.test(text) && !/\s/.test(text)) continue;
    const line = code.slice(0, match.index).split("\n").length;
    found.push({ text, line });
  }
  return found;
}

const QUERY =
  "a query or path parameter: only a hand-edited URL produces it (copy.md, Errors and empty states)";
const PICKER =
  "the control behind it offers only valid values, so only a broken client produces it (copy.md)";
const LAYOUT =
  "a dashboard-layout check: the layout editor only saves the panels it shows (copy.md)";
const CASE_FILE =
  "a check on the auto-reply case file, which no screen in the app lets a person write (copy.md)";

/**
 * Messages left without a full stop, by schema file, each with the reason no
 * reader of the app as built ever sees it. One a person can reach by typing is
 * copy again and leaves this table.
 */
const EXEMPT: Record<string, Record<string, string>> = {
  "activity.ts": {
    "Invalid actor filter": QUERY,
    "Invalid entity type filter": QUERY,
    "Invalid start date": QUERY,
    "Invalid end date": QUERY,
    "Invalid page": QUERY,
    "Invalid page size": QUERY,
    "Page size cannot exceed ${MAX_PAGE_SIZE}": QUERY,
    // The date filter's calendar picks a range in order, so only a URL can
    // put the start after the end (`ActivityFilters.tsx`).
    "Start date must be before end date": QUERY,
  },
  "tickets.ts": {
    "Invalid sort field": QUERY,
    "Invalid sort order": QUERY,
    "Invalid status filter": QUERY,
    "Invalid category filter": QUERY,
    "Invalid assignee filter": QUERY,
    "Invalid page": QUERY,
    "Invalid page size": QUERY,
    "Page size cannot exceed ${MAX_PAGE_SIZE}": QUERY,
    // Shown in the ticket page's alert, but only for a URL like `/tickets/abc`.
    "Invalid ticket id": QUERY,
    "Invalid range": QUERY,
    "Invalid scope": QUERY,
    "Invalid assignee": PICKER,
    "Invalid status": PICKER,
    "Invalid category": PICKER,
  },
  "dashboard.ts": {
    "Layout must place exactly the ${DASHBOARD_PANEL_IDS.length} current dashboard panels":
      LAYOUT,
    "Layout must include each current dashboard panel exactly once": LAYOUT,
  },
  "evals.ts": {
    "Two cases share an id": CASE_FILE,
    "A declined case needs an expected reason, and only a declined case may have one":
      CASE_FILE,
    "An adversarial case needs at least one payload marker, and only an adversarial case may have one":
      CASE_FILE,
    "An adversarial case needs at least one payload check, and only an adversarial case may have one":
      CASE_FILE,
    "A case expecting an output check to decline it must list that check among its payload checks":
      CASE_FILE,
    // The planned-run form's date-time picker never sends an unparseable time.
    "Invalid time": PICKER,
  },
};

const schemaFiles = readdirSync(SCHEMAS_DIR).filter((f) => f.endsWith(".ts"));
const scanned = schemaFiles.map((file) => ({
  file,
  messages: messagesIn(readFileSync(path.join(SCHEMAS_DIR, file), "utf8")),
}));

describe("validation messages end in a full stop (copy.md, #518)", () => {
  test("every message in packages/core/src/schemas does, or is exempt", () => {
    const missing = scanned.flatMap(({ file, messages }) =>
      messages
        .filter((m) => !m.text.endsWith("."))
        .filter((m) => EXEMPT[file]?.[m.text] === undefined)
        .map((m) => `packages/core/src/schemas/${file}:${m.line}  "${m.text}"`),
    );
    expect(missing).toEqual([]);
  });

  test("every exemption still names a message without one", () => {
    const stale = Object.entries(EXEMPT).flatMap(([file, messages]) =>
      Object.keys(messages)
        .filter(
          (text) =>
            !scanned.some(
              (s) =>
                s.file === file &&
                s.messages.some((m) => m.text === text && !text.endsWith(".")),
            ),
        )
        .map((text) => `${file}: "${text}"`),
    );
    expect(stale).toEqual([]);
  });

  test("the ticket input messages the schemas take from @ticket/shared do too", () => {
    const missing = Object.entries(TICKET_INPUT_MESSAGE)
      .filter(([, text]) => !text.endsWith("."))
      .map(([key]) => key);
    expect(missing).toEqual([]);
  });

  test("the scan finds messages in every form and skips the rest", () => {
    const source = [
      'import { z } from "zod";',
      '// "A comment is not a message"',
      'const a = z.email("Enter a valid email");',
      "const b = z.string().max(9, `Keep it to ${N} characters or fewer.`);",
      'ctx.addIssue({ code: "custom", path: ["userId"], message: "Choose a person" });',
      "const c = z.string({ error: 'Only the \"a\" target' });",
    ].join("\n");
    expect(messagesIn(source)).toEqual([
      { text: "Enter a valid email", line: 3 },
      { text: "Keep it to ${N} characters or fewer.", line: 4 },
      { text: "Choose a person", line: 5 },
      { text: 'Only the "a" target', line: 6 },
    ]);
  });
});
