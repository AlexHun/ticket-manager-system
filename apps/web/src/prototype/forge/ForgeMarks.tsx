/**
 * PROTOTYPE — four anvil-and-spark candidates for the mark. See forge-proto.ts.
 *
 * All four keep the 24×24 rounded plate so `LogoMark` and `favicon.svg` stay
 * one drawing. Colours are passed in rather than read from classes so the same
 * drawing can be serialised into a favicon with literal colours (a favicon
 * cannot see the page's CSS variables).
 */
import { cn } from "@/lib/utils";
import type { ForgeChoice } from "./forge-proto";

export type MarkPalette = {
  bronze: string;
  iron: string;
  steel: string;
  spark: string;
  dark: string;
};

export const CSS_MARK_PALETTE: MarkPalette = {
  bronze: "var(--forge-bronze)",
  iron: "var(--forge-iron)",
  steel: "var(--forge-steel)",
  spark: "var(--forge-spark)",
  dark: "var(--forge-dark)",
};

/** Side-view anvil: horn left, flat face, pinched waist, splayed feet. */
const ANVIL =
  "M3 11H21V13.3L17.4 13.9C16 14.6 15.8 15.9 16.2 17.3L18.6 18.6V20H6.4V18.6L8.8 17.3C9.2 15.9 9 14.6 7.6 13.9C5.6 13.6 4.2 12.6 3 11Z";
/** The same anvil drawn to the plate's edges — mass over detail at 16px. */
const ANVIL_HEAVY =
  "M1.5 10.5H22.5V13.4L18.2 14.2C16.6 15 16.4 16.5 16.8 18L19.5 19.5V21.5H4.5V19.5L7.2 18C7.6 16.5 7.4 15 5.8 14.2C3.6 13.8 2.4 12.6 1.5 10.5Z";
const STAR =
  "M15 2.6L15.85 5.35L18.6 6.2L15.85 7.05L15 9.8L14.15 7.05L11.4 6.2L14.15 5.35Z";

type Variant = Exclude<ForgeChoice["logo"], "current">;

export function ForgeMark({
  variant,
  className,
  colors = CSS_MARK_PALETTE,
}: {
  variant: Variant;
  className?: string;
  colors?: MarkPalette;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={cn("size-6", className)}
    >
      {variant === "A" && (
        <>
          <rect width="24" height="24" rx="5" fill={colors.iron} />
          <path d={ANVIL} fill={colors.bronze} />
          <path d={STAR} fill={colors.spark} />
        </>
      )}
      {variant === "B" && (
        <>
          <rect width="24" height="24" rx="5" fill={colors.iron} />
          <path d={ANVIL} fill={colors.steel} />
          <circle cx="14.6" cy="8" r="1.25" fill={colors.spark} />
          <circle cx="17.6" cy="5.4" r="0.95" fill={colors.spark} />
          <circle cx="20" cy="3.5" r="0.7" fill={colors.spark} />
          <circle cx="10.4" cy="6.6" r="0.75" fill={colors.spark} />
        </>
      )}
      {variant === "C" && (
        <>
          <rect width="24" height="24" rx="5" fill={colors.bronze} />
          <path d={ANVIL} fill={colors.dark} />
          <path d={STAR} fill={colors.dark} />
        </>
      )}
      {variant === "D" && (
        <>
          <rect width="24" height="24" rx="5" fill={colors.iron} />
          <rect
            x="0.6"
            y="0.6"
            width="22.8"
            height="22.8"
            rx="4.4"
            fill="none"
            stroke={colors.bronze}
            strokeWidth="1.2"
          />
          <path d={ANVIL_HEAVY} fill={colors.bronze} />
          <path d="M16.5 2.8L18.3 5.6L16.5 8.4L14.7 5.6Z" fill={colors.spark} />
          <circle cx="20" cy="3.6" r="0.9" fill={colors.spark} />
        </>
      )}
    </svg>
  );
}
