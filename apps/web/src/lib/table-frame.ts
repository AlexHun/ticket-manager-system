/**
 * The border, rounding and scrolling every scrollable table on this desk wears.
 *
 * It lived as a byte-identical private `FRAME` constant in `TicketsTable`,
 * `ActivityPage` and `UsersTable` (issue #109). Two copies was a coincidence,
 * three was a shape: a change to the radius, the ring colour or the scroll
 * behaviour had to land in every one of them and nothing caught a miss.
 *
 * Compose it with `cn(TABLE_FRAME, …)` — every call site adds its own layout
 * classes (`min-h-0 flex-1`, `grid place-items-center` for the empty state) on
 * top, which is why this is an exported class string rather than a wrapper
 * component.
 *
 * **The table's own min-width floor is deliberately not part of this.** The
 * frame scrolls; what makes it *need* to scroll is the `<table>` inside it, and
 * the right floor depends on the column count — `TicketsTable` computes one from
 * its resizable columns, `UsersTable` pins `min-w-2xl` for five columns
 * (#83), and `ActivityPage` sets none at all. Folding a single floor in here
 * would change two of the three tables' appearance for no measured reason.
 */
export const TABLE_FRAME = "overflow-auto rounded-lg ring-1 ring-border";
