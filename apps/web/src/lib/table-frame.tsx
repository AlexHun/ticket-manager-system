import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * The border, rounding and scrolling every scrollable table on this desk wears.
 *
 * It lived as a byte-identical private `FRAME` constant in `TicketsTable`,
 * `ActivityPage` and `UsersTable` (issue #109). Two copies was a coincidence,
 * three was a shape: a change to the radius, the ring colour or the scroll
 * behaviour had to land in every one of them and nothing caught a miss.
 *
 * It was an exported class string until issue #111, because every call site
 * adds its own layout classes (`min-h-0 flex-1`, `grid place-items-center` for
 * the empty state) on top. What made it a component is that the frame now
 * carries three things a class string cannot: `tabIndex`, `role` and a name.
 *
 * **The table's own min-width floor is deliberately not part of this.** The
 * frame scrolls; what makes it *need* to scroll is the `<table>` inside it, and
 * the right floor depends on the column count — `TicketsTable` computes one from
 * its resizable columns, `UsersTable` pins `min-w-2xl` for five columns
 * (#83), and `ActivityPage` sets none at all. Folding a single floor in here
 * would change two of the three tables' appearance for no measured reason.
 */
const FRAME =
  "overflow-auto rounded-lg ring-1 ring-border outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * All three of `role`, `aria-label` and `tabIndex` are omitted, not just
 * `role`: they are applied after `{...rest}`, so a call site that passed one
 * would have it silently dropped. Better a type error than a prop that looks
 * accepted and isn't.
 */
interface TableFrameProps
  extends Omit<ComponentProps<"div">, "role" | "aria-label" | "tabIndex"> {
  /**
   * The region's accessible name. Required, and that is the whole point of
   * the prop: `tabIndex={0}` on its own turns the frame into a tab stop that
   * announces nothing, which is a worse place for a screen-reader user to
   * land than the unreachable scroller it replaced.
   */
  label: string;
}

/**
 * A scrollable table frame a keyboard can actually operate (issue #111).
 *
 * A `overflow-auto` div is not focusable by default, so a keyboard-only user
 * has no way to reach the columns that overflow to the right or the rows below
 * the fold — sharpest on `UsersTable`, where scrolling horizontally at narrow
 * widths is the deliberate fix (#83) that keeps the layout from collapsing.
 *
 * The three attributes travel together and are not separable:
 *
 * - `tabIndex={0}` makes the scroller reachable, and is what arrow keys,
 *   Page Up/Down and Home/End act on once it holds focus.
 * - `role="region"` gives that tab stop a purpose in the accessibility tree,
 *   and puts the table in the landmark list.
 * - `aria-label` names it. A `region` with no accessible name is not exposed
 *   as a landmark at all, so an unnamed one buys the tab stop and none of the
 *   benefit.
 *
 * **The focus ring is part of the fix, not decoration.** A new tab stop that
 * shows nothing when it holds focus fails WCAG 2.4.7, and Tailwind's preflight
 * would otherwise leave the frame on the browser default outline — square,
 * ignoring the `rounded-lg`. `outline-none focus-visible:ring-3
 * focus-visible:ring-ring/50` is the same pair `button.tsx` wears, so a
 * focused frame reads like every other focused control here. It *replaces* the
 * resting `ring-1 ring-border` rather than stacking with it: one `ring`
 * property, and the border is the thing the thicker ring is drawn over.
 *
 * **Focusable whether or not it currently overflows.** Measuring overflow and
 * toggling `tabIndex` would avoid a dead tab stop on a wide window, but it
 * makes a control's presence depend on the viewport — it appears and vanishes
 * as the window resizes — and jsdom reports every scroll dimension as `0`, so
 * nothing here could test it. The empty states pay for this with one tab stop
 * that reads "Tickets, region — No tickets found."; that is a fair answer to
 * "what is in this table", not noise.
 *
 * **The skeletons keep their own "Loading …" names** rather than borrowing the
 * loaded table's, so the landmark is briefly called "Loading tickets" and then
 * "Tickets". A stable name plus `aria-busy` would read better in a landmark
 * list, but those names are the suite's handle on the loading state — a dozen
 * `getByLabelText("Loading tickets")` assertions across three test files
 * distinguish pending from settled by exactly this string, and collapsing the
 * two names would leave them unable to tell the states apart at all.
 *
 * Extra props are spread through for the per-call-site layout classes and for
 * `aria-busy` / `data-tutorial-anchor`; `role` is not overridable.
 */
export function TableFrame({
  label,
  className,
  children,
  ...rest
}: TableFrameProps) {
  return (
    <div
      {...rest}
      role="region"
      aria-label={label}
      tabIndex={0}
      className={cn(FRAME, className)}
    >
      {children}
    </div>
  );
}
