import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { BRAND_NAME } from "@/lib/brand";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/utils";

/** THE GREAT and DESK: the small spaced lines above and below FORGE. */
const SMALL_LINE =
  "flex items-center gap-3 text-[clamp(0.8rem,1.4vw,1.25rem)] font-bold tracking-[0.55em] text-muted-foreground";

/**
 * FORGE's size and place in the lockup, without its finish. The strike stacks
 * its heat copies inside a box of exactly this shape, so they sit on the
 * cooled word glyph for glyph.
 *
 * The capitals stand taller than the 0.8em line, and `lit-iron` paints only
 * inside the box, so the tops of O, R and G came out flat. `pt-[0.1em]` is
 * headroom for them, taken back from the margin so nothing moves; the strike's
 * copies carry the same headroom in `login-scene.css` — keep the two equal.
 */
export const FORGE_BOX =
  "-mt-[0.05em] pt-[0.1em] mb-[0.1em] -ml-[0.04em] text-[clamp(4.5rem,24vw,9rem)] leading-[0.8] font-black tracking-[0.015em] lg:text-[clamp(7rem,min(14vw,30vh),14rem)]";

/**
 * Where the strike is. `cooled` is the still lockup, which is also the only
 * state a visitor asking for reduced motion ever sees. `data-strike` carries
 * it for `login-scene.spec.ts`.
 */
export type Strike = "waiting" | "playing" | "cooled";

/** The strike reports where it landed, then that FORGE has cooled. */
export type StrikingWordProps = {
  onStrike: (word: DOMRect) => void;
  onCooled: () => void;
};

/** Where the strike landed, in viewport coordinates, once it has. */
export type EmberFieldProps = { struckAt: DOMRect | null };

/**
 * The strike and the embers, in a chunk of their own: every other page loads
 * this file, and none of them may download the effect (#343). A chunk that
 * fails to arrive leaves the lockup cooled and still, rather than dark.
 */
const scene = () =>
  import("./LoginScene").catch(() => ({
    StrikingWord: CoolAtOnce,
    EmberField: (_: EmberFieldProps) => null,
  }));
const StrikingWord = lazy(() =>
  scene().then((m) => ({ default: m.StrikingWord })),
);
const EmberField = lazy(() => scene().then((m) => ({ default: m.EmberField })));

function CoolAtOnce({ onCooled }: StrikingWordProps) {
  useEffect(onCooled, [onCooled]);
  return <StillForge />;
}

function StillForge({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn(FORGE_BOX, "lit-iron", className)}>
      Forge
    </span>
  );
}

/**
 * The login page's scene: the lockup THE GREAT / FORGE / DESK set large in lit
 * iron, lit by a low forge glow from below. The sidebar's `SidebarBrand` is the
 * same lockup at chrome size.
 *
 * With motion allowed, every mount strikes once: FORGE waits dark, is hit
 * white-hot and cools to iron, while embers rise from the glow for as long as
 * the page is open. Signing in navigates away, so it never strikes. With
 * reduced motion the lockup is cooled from its first paint and the scene's
 * chunk is never requested. Either way nothing here is interactive or waits
 * on anything, so the form beside it is usable the moment it paints.
 *
 * No mark and no illustration: the word is the whole picture. The letters are
 * drawn rather than read, so they are `aria-hidden` and the heading takes its
 * name from the one visually hidden line — "The Great Forge Desk".
 */
export function LoginLockup() {
  const reduced = useReducedMotion();
  const [strike, setStrike] = useState<Strike>(reduced ? "cooled" : "waiting");
  const [struckAt, setStruckAt] = useState<DOMRect | null>(null);

  // Motion withdrawn mid-strike: finish it at once.
  useEffect(() => {
    if (reduced) setStrike("cooled");
  }, [reduced]);

  const onStrike = useCallback((word: DOMRect) => {
    setStrike("playing");
    setStruckAt(word);
  }, []);
  const onCooled = useCallback(() => setStrike("cooled"), []);

  return (
    <div
      data-strike={strike}
      className="relative isolate flex min-h-68 items-center justify-center overflow-hidden px-4 py-12 lg:min-h-dvh"
    >
      <div aria-hidden="true" className="forge-glow absolute inset-0 -z-10" />
      {!reduced && (
        <Suspense fallback={null}>
          <EmberField struckAt={struckAt} />
        </Suspense>
      )}
      <h1 className="flex w-max max-w-full flex-col font-brand uppercase">
        <span className="sr-only">{BRAND_NAME}</span>
        <span aria-hidden="true" className={SMALL_LINE}>
          <span>The Great</span>
          <i className="brand-rule h-px min-w-8 flex-1" />
        </span>
        {strike === "cooled" ? (
          <StillForge />
        ) : (
          // Before the chunk lands the word waits dark, as the forge does.
          <Suspense fallback={<StillForge className="opacity-10" />}>
            <StrikingWord onStrike={onStrike} onCooled={onCooled} />
          </Suspense>
        )}
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
