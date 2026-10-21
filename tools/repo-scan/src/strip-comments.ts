/**
 * Blank out every comment in a JS, TS or JSON source, keeping every other
 * character and every newline, so a regex run over the result cannot match
 * inside a comment and a match's line number is still the source's.
 *
 * The one copy (#565). Every reader of source in both apps takes it from here:
 * the two standards guards (#390, #391), which ban forms rather than words and
 * must let a file explain *why* it avoids one; `validation-copy.test.ts`;
 * `doc-citations.ts` (#440), where a symbol that survives only in a comment
 * counts as gone, and `scripts/graph.ts` through it; and the project map's
 * scanner, `apps/web/dev/scan.ts`. A reader that wants only the text takes
 * `.code`.
 *
 * A character scanner rather than a line-based one, and the reason is a bug it
 * replaced: `path="/__dev/*"` contains `/*`, so a scanner that does not know it
 * is inside a string opens a block comment there and swallows the rest of the
 * file. Two routes silently vanished from the map. Strings, template literals
 * and regex literals are therefore all skipped over as units and kept.
 *
 * Template contents are *preserved*, not blanked: `api.get(\`/api/tickets/${id}\`)`
 * is read back out of this text by the project map's endpoint matcher.
 *
 * The one shape it gets wrong is a template literal nested inside another
 * template's `${…}`. The cost would be a missed comment in one file, not a
 * swallowed one.
 *
 * An import-free leaf, so nothing has a reason to mock it, and so the API's
 * compiler options and Vite's native config loader both read it as it is.
 */

export interface StrippedSource {
  /** The file with every comment blanked out, newlines preserved so line
   *  numbers still line up. */
  code: string;
  /** Lines on which anything survived. */
  codeLines: number;
  /** Lines that held something and on which nothing survived. */
  commentLines: number;
}

/**
 * Characters after which a `/` opens a regex literal rather than dividing.
 *
 * The distinction is decidable from the previous non-space character, because
 * division always follows a *value*: an identifier, a number, `)` or `]`. None
 * of those are in here, so anything else means a regex is starting.
 */
const REGEX_MAY_FOLLOW = new Set([
  "(",
  ",",
  "=",
  ":",
  "[",
  "!",
  "&",
  "|",
  "?",
  "{",
  ";",
  "+",
  "-",
  "*",
  "%",
  "<",
  ">",
  "~",
  "^",
  "\n",
]);

/** Past the closing quote of the string starting at `start`. */
function skipQuoted(source: string, start: number, quote: string): number {
  let at = start + 1;
  while (at < source.length) {
    const ch = source[at]!;
    if (ch === "\\") {
      at += 2;
      continue;
    }
    if (ch === quote) return at + 1;
    // A `'` or `"` string cannot span a line. Bailing on the newline stops one
    // stray apostrophe from swallowing the rest of the file.
    if (quote !== "`" && ch === "\n") return at;
    at += 1;
  }
  return at;
}

/** Past the closing `/` of the regex starting at `start`. */
function skipRegex(source: string, start: number): number {
  let at = start + 1;
  let inClass = false;
  while (at < source.length) {
    const ch = source[at]!;
    if (ch === "\\") {
      at += 2;
      continue;
    }
    // A `/` inside `[...]` is a literal slash, not the terminator.
    if (ch === "[") inClass = true;
    else if (ch === "]") inClass = false;
    else if (ch === "/" && !inClass) return at + 1;
    else if (ch === "\n") return at;
    at += 1;
  }
  return at;
}

export function stripComments(source: string): StrippedSource {
  const chars = source.split("");
  const blank = (from: number, to: number): void => {
    for (let at = from; at < to && at < chars.length; at += 1) {
      if (chars[at] !== "\n") chars[at] = " ";
    }
  };

  let at = 0;
  // Line start counts as "a statement may begin here", so a regex on its own
  // line is recognised.
  let previous = "\n";

  while (at < source.length) {
    const ch = source[at]!;
    const next = source[at + 1];

    if (ch === "/" && next === "/") {
      const eol = source.indexOf("\n", at);
      const end = eol === -1 ? source.length : eol;
      blank(at, end);
      at = end;
      continue;
    }

    if (ch === "/" && next === "*") {
      const close = source.indexOf("*/", at + 2);
      const end = close === -1 ? source.length : close + 2;
      blank(at, end);
      at = end;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      at = skipQuoted(source, at, ch);
      previous = ch;
      continue;
    }

    if (ch === "/" && REGEX_MAY_FOLLOW.has(previous)) {
      at = skipRegex(source, at);
      previous = "/";
      continue;
    }

    if (ch === "\n") previous = "\n";
    else if (ch !== " " && ch !== "\t" && ch !== "\r") previous = ch;
    at += 1;
  }

  // Counted from the result rather than tracked during the scan: a line is code
  // if anything survived, a comment if something was there and nothing did.
  const code = chars.join("");
  const before = source.split("\n");
  const after = code.split("\n");
  let codeLines = 0;
  let commentLines = 0;
  for (let line = 0; line < after.length; line += 1) {
    if (after[line]!.trim().length > 0) codeLines += 1;
    else if ((before[line] ?? "").trim().length > 0) commentLines += 1;
  }

  return { code, codeLines, commentLines };
}
