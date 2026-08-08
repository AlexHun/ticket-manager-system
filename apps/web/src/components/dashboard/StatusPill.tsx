import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The three states a KPI can be in. Ordered by severity so callers can compare.
 *
 * There is no "info" or "neutral" member on purpose: a tile with nothing to say
 * renders no pill at all, rather than a grey one. A pill that appears on every
 * tile in every state stops being a signal.
 */
export const KPI_STATUS = {
  good: "good",
  warning: "warning",
  critical: "critical",
} as const;

export type KpiStatus = (typeof KPI_STATUS)[keyof typeof KPI_STATUS];

const PILL: Record<
  KpiStatus,
  { icon: typeof CircleCheck; text: string; fill: string }
> = {
  [KPI_STATUS.good]: {
    icon: CircleCheck,
    text: "text-status-good",
    fill: "bg-status-good-soft",
  },
  [KPI_STATUS.warning]: {
    icon: TriangleAlert,
    text: "text-status-warning",
    fill: "bg-status-warning-soft",
  },
  [KPI_STATUS.critical]: {
    icon: CircleAlert,
    text: "text-status-critical",
    fill: "bg-status-critical-soft",
  },
};

/**
 * A state badge: tinted chip, icon, and a word.
 *
 * All three channels are mandatory, and the icon differs per state rather than
 * being one shape in three colours — this theme is monochrome green, so a green
 * "good" pill sits in the same hue family as every series colour on the page and
 * cannot carry its meaning by fill alone. The word is what actually says it; the
 * colour only makes it findable.
 *
 * `label` is the visible word. Keep it to one or two — this sits under a stat
 * value in a tile that is already carrying a number and a line of context.
 */
export function StatusPill({
  status,
  label,
  className,
}: {
  status: KpiStatus;
  label: string;
  className?: string;
}) {
  const { icon: Icon, text, fill } = PILL[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-medium",
        // Enter softly when a threshold flips — see `animate-status-in` in
        // index.css. Purely opacity+transform, so it composites.
        "animate-status-in",
        fill,
        text,
        className,
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden="true" />
      {label}
    </span>
  );
}
