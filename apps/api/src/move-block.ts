// What `bun scripts/move-block.ts` does to two files' text (#758): it cuts a
// line range out of one and inserts it into the other, so code is moved
// without an agent retyping it in a Write. It lives here rather than in
// `scripts/` for the reason `replace-once.ts` beside it gives: the develop
// image does not carry `scripts/`, and the API suite tests it there too.
//
// Lines are numbered from 1 and the range is inclusive. `at` inserts the block
// before that line of the target, and one past its last line appends, which
// is also what no `at` does. The moved lines take the target's line endings,
// or the source's when the target has none; every line outside the range
// keeps its own. A last line with no newline gains one when it is moved or
// appended to. A leading byte order mark is dropped from both, since no
// tracked file may carry one (`docs/standards/checks.md`). A range or `at`
// outside the file throws before anything is returned, so the script writes
// nothing.

export type MoveRange = { start: number; end: number; at?: number };

const BOM = String.fromCharCode(0xfeff);

const withoutBom = (text: string) =>
  text.startsWith(BOM) ? text.slice(BOM.length) : text;

// Each line with its own ending, the last one possibly without.
const linesOf = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];

const endingOf = (text: string) => {
  const first = /\r?\n/.exec(text);
  return first ? first[0] : undefined;
};

const withEnding = (line: string, ending: string) =>
  line.replace(/\r?\n$/, "") + ending;

export const moveBlock = (
  sourceText: string,
  targetText: string,
  { start, end, at }: MoveRange,
) => {
  const source = linesOf(withoutBom(sourceText));
  const target = linesOf(withoutBom(targetText));
  const range = `range ${start}-${end}`;
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    throw new Error(`move-block: ${range} is not whole lines`);
  }
  if (end < start) {
    throw new Error(`move-block: ${range} ends before it starts`);
  }
  if (start < 1 || end > source.length) {
    throw new Error(`move-block: ${range} is outside lines 1-${source.length}`);
  }
  const insertAt = at ?? target.length + 1;
  if (
    !Number.isInteger(insertAt) ||
    insertAt < 1 ||
    insertAt > target.length + 1
  ) {
    throw new Error(
      `move-block: --at ${insertAt} is outside lines 1-${target.length + 1}`,
    );
  }
  const ending = endingOf(targetText) ?? endingOf(sourceText) ?? "\n";
  const block = source
    .slice(start - 1, end)
    .map((line) => withEnding(line, ending));
  const before = target.slice(0, insertAt - 1);
  const last = before.at(-1);
  if (last !== undefined && !last.endsWith("\n")) {
    before[before.length - 1] = last + ending;
  }
  const remaining = [...source.slice(0, start - 1), ...source.slice(end)];
  return {
    source: remaining.join(""),
    target: [...before, ...block, ...target.slice(insertAt - 1)].join(""),
  };
};
