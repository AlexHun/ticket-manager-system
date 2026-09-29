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
 * `font-brand` — the lockup's face — rather than the serif. The serif is
 * reserved for the customer's own subject line (see the note in `index.css`):
 * a page heading is the app naming its own furniture, and giving it the serif
 * would spend that distinction on chrome and leave the subject with nothing of
 * its own. The brand face is the opposite claim — the app's own voice, which
 * is exactly what a page title is — and it is a size step up from the old
 * `text-2xl` because a condensed cut sets narrower at the same size.
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
        <h1 className="font-brand text-3xl leading-tight font-bold tracking-wide">
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
