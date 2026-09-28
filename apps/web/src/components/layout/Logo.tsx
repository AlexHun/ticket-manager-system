import { BRAND_NAME } from "@/lib/brand";
import { cn } from "@/lib/utils";

/**
 * The product's name set in its own face, beside the mark on the pages seen
 * before sign-in. After sign-in the sidebar's lockup (`SidebarBrand`) carries
 * it instead.
 */
export function BrandName({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "font-brand text-2xl font-extrabold tracking-wide uppercase",
        className,
      )}
    >
      {BRAND_NAME}
    </span>
  );
}

/**
 * The hallmark: the clipped-corner punch a smith strikes into finished work,
 * with a soot anvil knocked out of it and a hot bar lying on the anvil face —
 * the piece being worked, which is what a ticket is here. The same drawing as
 * `public/favicon.svg`, so the tab and the app read as one identity.
 *
 * The colours are literals, and the same three as the favicon's, which cannot
 * read the page's CSS variables at all. The palette slice of the rebrand turns
 * them into tokens here; the favicon keeps its copies — change them together.
 *
 * `aria-hidden` because every place this renders pairs it with the product's
 * name — the link or heading takes its accessible name from that text.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={cn("size-6", className)}
    >
      {/* The punch: a square with its corners struck off. */}
      <path
        d="M4.2 0.8H19.8L23.2 4.2V19.8L19.8 23.2H4.2L0.8 19.8V4.2Z"
        fill="#bf8d5b"
      />
      <path
        d="M5 2.6H19L21.4 5V19L19 21.4H5L2.6 19V5Z"
        fill="none"
        stroke="#130e0c"
        strokeOpacity={0.35}
        strokeWidth={0.9}
      />
      {/* Side-view anvil: horn left, flat face, pinched waist, splayed feet. */}
      <path
        d="M2.6 11.4C4.4 10.6 6 10.4 7.8 10.4H20.6L21.2 10.9V13.2L18.2 13.9C16.8 14.5 16.4 15.6 16.6 16.9L18.8 18.1V19.6H6.6V18.1L8.8 16.9C9 15.6 8.6 14.5 7.4 14C5.6 13.6 4 12.8 2.6 11.4Z"
        fill="#130e0c"
      />
      {/* The work: a hot bar on the face. */}
      <path
        d="M9.4 7.6H18.4Q19.4 7.6 19.4 8.6Q19.4 9.6 18.4 9.6H9.4Q8.4 9.6 8.4 8.6Q8.4 7.6 9.4 7.6Z"
        fill="#ffaf38"
      />
    </svg>
  );
}
