/**
 * Query keys for the tutorial editor.
 *
 * One key, because the editor is one request: `GET /api/tutorials` returns
 * every page's content in a single array (see `tutorialsRouter`), unlike the
 * knowledge base, which has a list and a separate per-article revision
 * history. A save invalidates `list` and every open dialog's `defaultValues`
 * refreshes from the refetched row.
 */
export const tutorialKeys = {
  list: ["tutorials", "list"] as const,
};
