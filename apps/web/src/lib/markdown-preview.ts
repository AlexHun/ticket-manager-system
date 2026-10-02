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

// Text that must come through the inline passes untouched — code, and escaped
// characters — is swapped for a numbered marker built from two private-use
// characters and swapped back at the end. Written as code points rather than
// literals so the source shows what they are. Any already in the body are
// dropped first: they render as nothing, and left in they could forge a marker.
const HOLD_OPEN = String.fromCharCode(0xe000);
const HOLD_CLOSE = String.fromCharCode(0xe001);
const HOLD_CHARS = new RegExp(`[${HOLD_OPEN}${HOLD_CLOSE}]`, "g");
const HELD = new RegExp(`${HOLD_OPEN}(\\d+)${HOLD_CLOSE}`, "g");

const FENCE = /^\s*(```|~~~)/;
const BULLET = /^\s*[-*+]\s+/;
// The number is captured so a wrapped line that merely starts with one ("2024.
// was the year…") is not read as a list: CommonMark lets an ordered list
// interrupt a paragraph only when it starts at 1.
const ORDERED = /^\s*(\d{1,9})[.)]\s+/;

export function markdownPreview(body: string): string {
  const held: string[] = [];
  const hold = (text: string) => {
    held.push(text);
    return `${HOLD_OPEN}${held.length - 1}${HOLD_CLOSE}`;
  };

  // Block syntax is a property of a line, so it goes before the lines are
  // joined. Everything after the join may span a hard wrap — stored bodies
  // keep theirs, as in KB-007's "**5–10\nbusiness days**".
  const lines: string[] = [];
  let inFence = false;
  let previous = "";
  for (const line of body.replace(HOLD_CHARS, "").split(/\r?\n/)) {
    if (FENCE.test(line)) {
      inFence = !inFence;
    } else if (inFence) {
      lines.push(hold(line.trim()));
    } else {
      const ordered = ORDERED.exec(line);
      const startsBlock =
        previous.trim() === "" ||
        BULLET.test(previous) ||
        ORDERED.test(previous);
      lines.push(
        line
          // Horizontal rules and setext heading underlines.
          .replace(/^\s*(([-*_])(\s*\2){2,}|=+)\s*$/, "")
          // Reference-style link definitions: the URL is not prose.
          .replace(/^\s{0,3}\[[^\]]+\]:\s+\S.*$/, "")
          .replace(/^\s*(>\s?)+/, "")
          .replace(/^\s{0,3}#{1,6}\s+/, "")
          .replace(BULLET, "")
          .replace(ORDERED, (marker) =>
            ordered && (startsBlock || ordered[1] === "1") ? "" : marker,
          ),
      );
    }
    previous = line;
  }

  const text = lines
    .join(" ")
    // Code first, so a backslash inside it stays a backslash.
    .replace(/(`+)(.+?)\1/g, (_, _ticks: string, code: string) =>
      hold(code.trim()),
    )
    // `\*` is a literal asterisk, not the start of emphasis.
    .replace(/\\([\\`*_{}[\]()#+\-.!~>|<])/g, (_, ch: string) => hold(ch))
    // One level of parentheses inside a URL, as in a Wikipedia link.
    .replace(/!\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g, "$1")
    .replace(/\[([^\]]+)\]\((?:[^()]|\([^()]*\))*\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    .replace(/<((?:https?|mailto):[^>\s]+|[^>\s@]+@[^>\s]+)>/g, "$1")
    .replace(/(?<![\w*])\*\*(?=\S)(.+?)(?<=\S)\*\*(?![\w*])/g, "$1")
    .replace(/(?<!\w)__(?=\S)(.+?)(?<=\S)__(?!\w)/g, "$1")
    .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, "$1")
    .replace(/(?<![\w*])\*(?=\S)(.+?)(?<=\S)\*(?![\w*])/g, "$1")
    .replace(/(?<!\w)_(?=\S)(.+?)(?<=\S)_(?!\w)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  // Markers never nest — code is held before escapes, so no held text
  // contains one — and a single pass restores every one.
  return text.replace(HELD, (_, i: string) => held[Number(i)] ?? "");
}
