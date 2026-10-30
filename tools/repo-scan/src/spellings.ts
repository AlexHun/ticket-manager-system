/**
 * The other ways a banned literal can be written, in one place for both
 * standards guards. Review kept sending back a spelling a guard's form had
 * missed — a quoted or optional key, a backtick literal, a `.ts` or `/index`
 * suffix (`270a8c7`) — and the two guards kept separate copies of the role
 * literal that had drifted apart, the API's reading a backtick and a quoted
 * key and the web's neither.
 *
 * Two halves. The regex pieces (`QUOTE`, `NOT_QUOTE`, `OPENS_LITERAL`,
 * `literal`, `key`, `MODULE_SUFFIX`) are what a form is built from, so a form
 * names the value and the spellings come free. And
 * `inEveryQuote` is what `checkRules` runs each `catches` line through, so a
 * form that reads only the quote its fixture was typed in fails its own
 * examples rather than waiting for review.
 */

/** A quote that opens or closes a string literal: double, single or backtick. */
export const QUOTE = String.raw`["'\`]`;

/**
 * Regex source for the opening of a literal that does not start by reading
 * something: a double or single quote, or a backtick not followed by `${`.
 * `"/tickets"` and `` `/tickets` `` are typed paths;
 * `` `${ROUTE.tickets.path}?q=1` `` is the record plus a query.
 */
export const OPENS_LITERAL = String.raw`(?:["']|\`(?!\$\{))`;

/** Regex source for one character that is neither a quote nor a line break:
 *  a piece of the text inside a literal, as `${NOT_QUOTE}*` reads it whole. */
export const NOT_QUOTE = String.raw`[^"'\`\n]`;

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

/**
 * Regex source for what may follow a module specifier's path before its
 * closing quote: nothing, a source extension (`.ts`, `.mjs`, `.tsx`…), or
 * `/index` with or without one. `./db`, `./db.ts` and `./db/index` are one
 * module to a loader, so a form that names the first must read all three.
 */
export const MODULE_SUFFIX = String.raw`(?:\.[cm]?[jt]sx?|\/index(?:\.[cm]?[jt]sx?)?)?`;

const QUOTES = [`"`, `'`, "`"] as const;

/** Each literal on one line in quote `quote`, escapes included. */
const quotedIn = (quote: string) =>
  new RegExp(String.raw`${quote}((?:[^${quote}\\\n]|\\.)*)${quote}`, "g");

/**
 * `line` as typed, then with every literal in the quote it was typed in —
 * the quote that opens its first literal — rewritten in each of the other
 * two. A rewrite that would need escaping (a literal holding the new quote,
 * or `${` for a backtick) is left out rather than changed, so each line
 * returned says what its original said. A line with no literal is returned
 * alone.
 */
export function inEveryQuote(line: string): string[] {
  const first = QUOTES.map((quote) => ({
    quote,
    at: line.search(quotedIn(quote)),
  }))
    .filter(({ at }) => at >= 0)
    .sort((a, b) => a.at - b.at)[0];
  if (!first) return [line];
  const typed = quotedIn(first.quote);
  const literals = [...line.matchAll(typed)].map((match) => match[1]!);
  const spellings = [line];
  for (const quote of QUOTES) {
    if (quote === first.quote) continue;
    const unsafe = (text: string) =>
      text.includes(quote) || (quote === "`" && text.includes("${"));
    if (literals.some(unsafe)) continue;
    spellings.push(
      line.replace(typed, (_, text: string) => `${quote}${text}${quote}`),
    );
  }
  return spellings;
}
