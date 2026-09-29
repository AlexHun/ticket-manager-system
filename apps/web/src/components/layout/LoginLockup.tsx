import { BRAND_NAME } from "@/lib/brand";
import { cn } from "@/lib/utils";

/** THE GREAT and DESK: the small spaced lines above and below FORGE. */
const SMALL_LINE =
  "flex items-center gap-3 text-[clamp(0.8rem,1.4vw,1.25rem)] font-bold tracking-[0.55em] text-muted-foreground";

/**
 * The login page's scene: the lockup THE GREAT / FORGE / DESK set large in lit
 * iron, lit by a low forge glow from below. The sidebar's `SidebarBrand` is the
 * same lockup at chrome size.
 *
 * This is the cooled, still state, and it is also exactly what a visitor who
 * asks for reduced motion sees — the final state, not a fallback. Nothing here
 * is interactive or waits on anything, so the form beside it is usable the
 * moment it paints.
 *
 * No mark and no illustration: the word is the whole picture. The letters are
 * drawn rather than read, so they are `aria-hidden` and the heading takes its
 * name from the one visually hidden line — "The Great Forge Desk".
 */
export function LoginLockup() {
  return (
    <div className="relative isolate flex min-h-68 items-center justify-center overflow-hidden px-4 py-12 lg:min-h-dvh">
      <div aria-hidden="true" className="forge-glow absolute inset-0 -z-10" />
      <h1 className="flex w-max max-w-full flex-col font-brand uppercase">
        <span className="sr-only">{BRAND_NAME}</span>
        <span aria-hidden="true" className={SMALL_LINE}>
          <span>The Great</span>
          <i className="brand-rule h-px min-w-8 flex-1" />
        </span>
        <span
          aria-hidden="true"
          className="lit-iron mt-[0.05em] mb-[0.1em] -ml-[0.04em] text-[clamp(4.5rem,24vw,9rem)] leading-[0.8] font-black tracking-[0.015em] lg:text-[clamp(7rem,min(14vw,30vh),14rem)]"
        >
          Forge
        </span>
        {/* The negative margin takes back the tracking after the last letter,
            so DESK ends flush with FORGE — keep it equal to SMALL_LINE's. */}
        <span
          aria-hidden="true"
          className={cn(SMALL_LINE, "-mr-[0.55em] justify-end")}
        >
          <i className="brand-rule h-px min-w-8 flex-1 -scale-x-100" />
          <span>Desk</span>
        </span>
      </h1>
    </div>
  );
}
