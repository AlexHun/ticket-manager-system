import { cn } from "@/lib/utils";

/**
 * The project mark: the lucide `ticket` glyph on a rounded plate, the same
 * drawing as `public/favicon.svg` so the tab and the app read as one identity.
 *
 * Colour comes from `--sidebar-primary` / `--sidebar-primary-foreground`, which
 * `index.css` already defines per mode. That is deliberate over branching in
 * JS: `useTheme` is a local hook rather than a context (see the `--viz-*` note
 * in `index.css`), so a JS-side palette would have to be re-derived by every
 * component that draws the mark. CSS resolves it once, in whichever mode is in
 * force.
 *
 * `aria-hidden` because every place this renders pairs it with the wordmark —
 * the link takes its accessible name from that text, not from here.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={cn("size-6", className)}
    >
      <rect width="24" height="24" rx="5" className="fill-sidebar-primary" />
      <g
        className="stroke-sidebar-primary-foreground"
        fill="none"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        transform="translate(3.6 3.6) scale(0.7)"
      >
        <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
        <path d="M13 5v2" />
        <path d="M13 11v2" />
        <path d="M13 17v2" />
      </g>
    </svg>
  );
}
