import type { ReactNode } from "react";
import { HOW_IT_WORKS_LABEL } from "@/lib/how-it-works/dom";

/**
 * The side panel both How it works views share: what is selected, explained,
 * or a hint until something is. A live region, so a screen reader hears the
 * explanation a selection brings in.
 */
export function DetailsPanel({
  title,
  hint,
  children,
}: {
  /** The selection's title; null while nothing is selected. */
  title: string | null;
  /** What the panel says while nothing is selected. */
  hint: string;
  children?: ReactNode;
}) {
  return (
    <section
      aria-label={HOW_IT_WORKS_LABEL.details}
      aria-live="polite"
      className="shrink-0 rounded-lg border bg-card p-4 2xl:w-80"
    >
      {title !== null ? (
        <>
          <h2 className="font-heading text-base font-semibold">{title}</h2>
          {children}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{hint}</p>
      )}
    </section>
  );
}
