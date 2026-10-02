/**
 * One line of plain text from a Markdown article body, for the `/knowledge`
 * row preview (#399). Syntax is removed and the words are kept:
 * `**Forgot password?**` reads `Forgot password?`, `[text](url)` reads `text`.
 *
 * It returns a string, and the caller renders it as a React text child, so
 * nothing here can turn into markup. That is the point rather than a
 * limitation: article bodies are model-facing corpus content (see
 * `docs/standards/security-auto-reply.md`), and a preview that rendered
 * Markdown as HTML would be a path for author-supplied HTML onto the page.
 * Anything this does not recognise, `<b>` included, stays as literal text.
 *
 * The stored body is untouched — this is a view of it, not an edit.
 */

// Private-use characters, which no article contains, to fence off text that
// must survive the emphasis passes untouched: escaped characters and code spans.
const HOLD_OPEN = "";
const HOLD_CLOSE = "";
const HELD = new RegExp(`${HOLD_OPEN}(\\d+)${HOLD_CLOSE}`, "g");

export function markdownPreview(body: string): string {
  const held: string[] = [];
  const hold = (text: string) => {
    held.push(text);
    return `${HOLD_OPEN}${held.length - 1}${HOLD_CLOSE}`;
  };

  const lines = body
    // `\*` is a literal asterisk, not the start of emphasis.
    .replace(/\\([\\`*_{}[\]()#+\-.!~>|<])/g, (_, ch: string) => hold(ch))
    .split(/\r?\n/)
    .map((line) =>
      line
        // Code fence delimiters; the code between them is kept as text.
        .replace(/^\s*(```|~~~).*$/, "")
        // Horizontal rules.
        .replace(/^\s*([-*_])(\s*\1){2,}\s*$/, "")
        .replace(/^\s*(>\s?)+/, "")
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/^\s*([-*+]|\d+[.)])\s+/, ""),
    );

  const text = lines
    .join("\n")
    .replace(/(`+)(.+?)\1/g, (_, _ticks: string, code: string) =>
      hold(code.trim()),
    )
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    .replace(/<((?:https?|mailto):[^>\s]+|[^>\s@]+@[^>\s]+)>/g, "$1")
    .replace(/(?<![\w*])\*\*(?=\S)(.+?)(?<=\S)\*\*(?![\w*])/g, "$1")
    .replace(/(?<!\w)__(?=\S)(.+?)(?<=\S)__(?!\w)/g, "$1")
    .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, "$1")
    .replace(/(?<![\w*])\*(?=\S)(.+?)(?<=\S)\*(?![\w*])/g, "$1")
    .replace(/(?<!\w)_(?=\S)(.+?)(?<=\S)_(?!\w)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  return text.replace(HELD, (_, i: string) => held[Number(i)] ?? "");
}
