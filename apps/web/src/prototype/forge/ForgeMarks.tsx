/**
 * PROTOTYPE — the mark. See forge-proto.ts.
 *
 * A hallmark rather than an app tile: the clipped-corner punch a smith strikes
 * into finished work, with the anvil knocked out of it and a hot bar lying on
 * the anvil face — the piece being worked, which is what a ticket is here. The
 * earlier rounded-plate-plus-sparkle candidates were dropped: the rounded tile
 * is every app icon, and the four-point star is every AI product's icon.
 *
 * Colours are passed in rather than read from classes so the same drawing can
 * be serialised into a favicon with literal colours.
 */
import { cn } from "@/lib/utils";
import type { ForgeChoice } from "./forge-proto";

export type MarkPalette = {
  bronze: string;
  iron: string;
  soot: string;
  heat: string;
};

export const CSS_MARK_PALETTE: MarkPalette = {
  bronze: "var(--forge-bronze)",
  iron: "var(--forge-iron)",
  soot: "var(--forge-soot)",
  heat: "var(--forge-heat)",
};

/** The punch: a square with its corners struck off. */
const PUNCH = "M4.2 0.8H19.8L23.2 4.2V19.8L19.8 23.2H4.2L0.8 19.8V4.2Z";
const PUNCH_INNER = "M5 2.6H19L21.4 5V19L19 21.4H5L2.6 19V5Z";
/** Side-view anvil: horn left, flat face, pinched waist, splayed feet. */
const ANVIL =
  "M2.6 11.4C4.4 10.6 6 10.4 7.8 10.4H20.6L21.2 10.9V13.2L18.2 13.9C16.8 14.5 16.4 15.6 16.6 16.9L18.8 18.1V19.6H6.6V18.1L8.8 16.9C9 15.6 8.6 14.5 7.4 14C5.6 13.6 4 12.8 2.6 11.4Z";
/** The work: a hot bar on the face. */
const BAR =
  "M9.4 7.6H18.4Q19.4 7.6 19.4 8.6Q19.4 9.6 18.4 9.6H9.4Q8.4 9.6 8.4 8.6Q8.4 7.6 9.4 7.6Z";

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
  const bronzePunch = variant === "H1";
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={cn("size-6", className)}
    >
      <path d={PUNCH} fill={bronzePunch ? colors.bronze : colors.iron} />
      <path
        d={PUNCH_INNER}
        fill="none"
        stroke={bronzePunch ? colors.soot : colors.bronze}
        strokeOpacity={bronzePunch ? 0.35 : 0.9}
        strokeWidth="0.9"
      />
      <path d={ANVIL} fill={bronzePunch ? colors.soot : colors.bronze} />
      <path d={BAR} fill={colors.heat} />
    </svg>
  );
}
