// The byte order mark and newline rules `replace-once.ts` and `move-block.ts`
// share, so the two file tools cannot disagree about a file (#758). A leading
// byte order mark is dropped, since no tracked file may carry one
// (`docs/standards/checks.md`).

export const BOM = String.fromCharCode(0xfeff);

export const withoutBom = (text: string) =>
  text.startsWith(BOM) ? text.slice(BOM.length) : text;

// A file's newline: CRLF when it holds one, LF when it holds only those, and
// `undefined` when it has no newline at all, for the caller to choose.
export const newlineOf = (text: string) => {
  if (text.includes("\r\n")) return "\r\n";
  if (text.includes("\n")) return "\n";
  return undefined;
};
