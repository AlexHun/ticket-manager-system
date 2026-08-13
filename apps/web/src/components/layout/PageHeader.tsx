import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A page's own name, and the controls that belong to the page rather than to
 * its content.
 *
 * Every section used to be named once, in the top bar, at 14px — the same size
 * as the sign-out button beside it and smaller than the rows underneath. Three
 * screens of very different weight therefore opened identically, and the
 * document had no heading a screen reader could jump to. The bar has stopped
 * naming pages entirely (see `AppTopBar`) so this is the only place it happens,
 * and nothing is said twice.
 *
 * `font-heading` rather than the serif, and this is the one deliberate omission
 * in the type system: the serif is reserved for the customer's own subject line
 * (see the note in `index.css`). A page heading is the app naming its own
 * furniture, which is the least interesting text on the screen — giving it the
 * display face would spend the distinction on chrome and leave the subject with
 * nothing of its own.
 *
 * `children` are the page's controls — a filter row, a primary action. They sit
 * on the heading's line rather than a row of their own, which is what keeps the
 * heading free: on the dashboard and the users page this replaces an existing
 * right-aligned row instead of adding one.
 */
export function PageHeader({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // `items-end` so a control lines up with the heading's baseline rather
        // than floating beside a two-line block. `shrink-0` because these sit
        // above panes that own their scrolling — see the height chain in
        // AppShell — and a header that can be squeezed makes the page below it
        // taller than the frame.
        "mb-4 flex shrink-0 flex-wrap items-end justify-between gap-x-6 gap-y-3",
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          {title}
        </h1>
        {description && (
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {children && (
        <div className="flex flex-wrap items-center gap-3">{children}</div>
      )}
    </div>
  );
}
