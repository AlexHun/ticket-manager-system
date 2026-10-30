/**
 * The other ways a banned literal can be written, in one place for both
 * standards guards. Review kept sending back a spelling a guard's form had
 * missed — a quoted or optional key, a backtick literal, a `.ts` or `/index`
 * suffix (`270a8c7`) — and the two guards kept separate copies of the role literal that had drifted
 * apart, the API's reading a backtick and a quoted key and the web's neither.
 *
 * Two halves. The regex pieces (`QUOTE`, `literal`, `key`) are what a form is
 * built from, so a form names the value and the quoting comes free. And
 * `inEveryQuote` is what `checkRules` runs each `catches` line through, so a
 * form that reads only the quote its fixture was typed in fails its own
 * examples rather than waiting for review.
 */

/** A quote that opens or closes a string literal: double, single or backtick. */
export const QUOTE = String.raw`["'\`]`;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Regex source for any of `values` as a whole string literal, in any quote. */
export const literal = (...values: string[]): string =>
  `${QUOTE}(?:${values.map(escape).join("|")})${QUOTE}`;

/**
 * Regex source for an object key named any of `names`, up to and including
 * its colon: bare (`role:`), quoted in any quote (`"role":`) or optional
 * (`role?:`).
 */
export const key = (...names: string[]): string => {
  const name = `(?:${names.map(escape).join("|")})`;
  return String.raw`(?:(?<![\w$])${name}|${QUOTE}${name}${QUOTE})\s*\??\s*:`;
};

/** A double-quoted literal on one line, escapes included. */
const DOUBLE_QUOTED = /"((?:[^"\\\n]|\\.)*)"/g;

/**
 * `line` as typed, then with every double-quoted literal in it rewritten in
 * single quotes, then in backticks. A rewrite that would need escaping (a
 * literal holding the new quote, or `${` for a backtick) is left out rather
 * than changed, so each line returned says what its original said. A line
 * with no double-quoted literal is returned alone.
 */
export function inEveryQuote(line: string): string[] {
  const literals = [...line.matchAll(DOUBLE_QUOTED)].map((match) => match[1]!);
  if (literals.length === 0) return [line];
  const spellings = [line];
  for (const quote of ["'", "`"]) {
    const unsafe = (text: string) =>
      text.includes(quote) || (quote === "`" && text.includes("${"));
    if (literals.some(unsafe)) continue;
    spellings.push(
      line.replace(
        DOUBLE_QUOTED,
        (_, text: string) => `${quote}${text}${quote}`,
      ),
    );
  }
  return spellings;
}
