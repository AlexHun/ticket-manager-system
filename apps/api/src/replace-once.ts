// What `bun scripts/replace-once.ts` does to a file's text (#629). It lives
// here rather than in `scripts/`, which the develop image does not carry
// (`.dockerignore`), so the API suite can test it there as on a clone; the
// script only reads argv and the two files, the split `scripts/graph.ts`
// keeps with `doc-citations.ts`.
//
// Each `[from, to]` pair is applied in order to what the pairs before it left,
// and must occur exactly once there, overlapping occurrences counted. A `\n`
// in a pair matches CRLF too, and the replacement takes the line endings of
// what it replaced, or of the file when the match held no newline. A leading
// byte order mark is dropped, since no tracked file may carry one
// (`docs/standards/checks.md`). Every pair that fails is named in one throw.
//
// `revert` applies the pairs as `[to, from]`, last first, so the pairs file
// that made an edit undoes it. A pair whose `to` is empty cannot be reverted.

export type Pair = [from: string, to: string];

const BOM = String.fromCharCode(0xfeff);

const NEWLINE = /\r?\n/;

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const occurrences = (text: string, from: string) => {
  const pattern = new RegExp(
    from.split(NEWLINE).map(escapeRegExp).join("\\r?\\n"),
    "g",
  );
  const found: RegExpExecArray[] = [];
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    found.push(match);
    pattern.lastIndex = match.index + 1;
  }
  return found;
};

const endingOf = (matched: string, fileEnding: string) => {
  if (matched.includes("\r\n")) return "\r\n";
  if (matched.includes("\n")) return "\n";
  return fileEnding;
};

export const replaceOnce = (
  text: string,
  pairs: readonly Pair[],
  { revert = false }: { revert?: boolean } = {},
) => {
  let result = text.startsWith(BOM) ? text.slice(BOM.length) : text;
  const fileEnding = result.includes("\r\n") ? "\r\n" : "\n";
  const steps = pairs.map((pair, index) => ({
    number: index + 1,
    from: revert ? pair[1] : pair[0],
    to: revert ? pair[0] : pair[1],
  }));
  if (revert) steps.reverse();
  const failures: string[] = [];
  for (const { number, from, to } of steps) {
    const label = `replace-once: pair ${number}`;
    if (from === "") {
      failures.push(`${label} has an empty search string`);
      continue;
    }
    const found = occurrences(result, from);
    if (found.length !== 1) {
      failures.push(
        `${label} (${JSON.stringify(from)}) matches ${found.length} times`,
      );
      continue;
    }
    const [match] = found;
    result =
      result.slice(0, match.index) +
      to.split(NEWLINE).join(endingOf(match[0], fileEnding)) +
      result.slice(match.index + match[0].length);
  }
  if (failures.length > 0) throw new Error(failures.join("\n"));
  return result;
};

export const isPair = (value: unknown): value is Pair =>
  Array.isArray(value) &&
  value.length === 2 &&
  typeof value[0] === "string" &&
  typeof value[1] === "string";
