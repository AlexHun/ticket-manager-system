/**
 * The one place the project map decides what the search box matches.
 *
 * It exists because the comparison used to be written out per view — an inline
 * `id.toLowerCase().includes(query)` in the graph and another in the table — and
 * a rule that lives in the views is a rule the views can quietly disagree about.
 * They did: Overview and Wiring were written later and simply never grew one, so
 * the box labelled "Find a module" did nothing on the tab the page opens on.
 *
 * Wiring a view in is now naming the fields it searches, not reimplementing the
 * match.
 */

/**
 * Whether any of `fields` contains `query`.
 *
 * `query` arrives trimmed and lowercased — `ProjectMapPage` debounces it in that
 * form — and an **empty query matches everything**, which is the part that earns
 * this its own function: every caller can filter unconditionally instead of
 * branching on "is the user searching", and a view can no longer forget the
 * branch and drop its whole list when the box is empty.
 *
 * Substring, not fuzzy. The ids being searched are repo-relative paths, so a
 * substring already covers the two things people type — part of a directory, or
 * part of a filename — and a fuzzy match over 300 paths mostly finds noise.
 */
export function matchesQuery(
  query: string,
  ...fields: (string | null | undefined)[]
): boolean {
  if (query.length === 0) return true;
  return fields.some(
    (field) => field != null && field.toLowerCase().includes(query),
  );
}

/**
 * The count for a card heading: `12` at rest, `3 of 12` while the search is
 * narrowing it.
 *
 * A heading that keeps saying `12` over three visible rows is the same failure
 * as the filter bar's frozen counter — the number is what people read to confirm
 * the search took, so it has to move when the list does.
 */
export function countLabel(shown: number, total: number): string {
  return shown === total ? `${total}` : `${shown} of ${total}`;
}
