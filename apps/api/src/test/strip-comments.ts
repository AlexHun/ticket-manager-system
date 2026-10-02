/**
 * Blank out every comment in a TypeScript source, keeping every other character
 * and every newline — so a regex run over the result cannot match inside a
 * comment, and a match's line number is still the source's.
 *
 * For `standards-guard.test.ts` (#391), which bans forms rather than words and
 * must let a file explain *why* it avoids one. The same scanner as
 * `apps/web/dev/scan.ts`'s `stripComments`, copied rather than imported: that
 * module is the web workspace's project-map scanner, it imports the web's
 * protocol types, and the API's `tsconfig` does not reach outside `src/`. A
 * fix to either copy belongs in both.
 *
 * A character scanner rather than a line-based one, because a string can hold
 * what looks like a comment opener — `"/__dev/*"` — and a scanner that does not
 * know it is inside a string swallows the rest of the file there. Strings,
 * template literals and regex literals are skipped over as units and kept.
 *
 * The one shape it gets wrong is a template literal nested inside another
 * template's `${…}`; the cost would be a missed comment in one file, not a
 * swallowed one.
 *
 * An import-free leaf, so nothing has a reason to mock it.
 */

/**
 * Characters after which a `/` opens a regex literal rather than dividing.
 * Division always follows a value — an identifier, a number, `)` or `]` — and
 * none of those are in here.
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

export function stripComments(source: string): string {
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

  return chars.join("");
}
