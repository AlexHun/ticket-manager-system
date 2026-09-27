/**
 * PROTOTYPE — the floating bar that flips the three forge axes. Dev only;
 * mounted from main.tsx behind `import.meta.env.DEV`.
 *
 * ← / → cycle the highlighted axis; click an axis name to highlight it.
 */
import { useEffect, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ForgeMark } from "./ForgeMarks";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  FORGE_AXES,
  cycleForge,
  useForge,
  type ForgeAxis,
} from "./forge-proto";

const AXIS_LABEL: Record<ForgeAxis, string> = {
  logo: "Logo",
  font: "Font",
  palette: "Palette",
};

let ORIGINAL_ICON: string | undefined;

export function ForgeSwitcher() {
  const choice = useForge();
  const [active, setActive] = useState<ForgeAxis>("palette");

  // The real tab icon follows the chosen mark, in the chosen palette's literal
  // colours — a favicon cannot read the page's CSS variables.
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) return;
    ORIGINAL_ICON ??= link.href;
    if (choice.logo === "current") {
      link.href = ORIGINAL_ICON;
      return;
    }
    const style = getComputedStyle(document.documentElement);
    const read = (name: string) => style.getPropertyValue(name).trim();
    const svg = renderToStaticMarkup(
      <ForgeMark
        variant={choice.logo}
        colors={{
          bronze: read("--forge-bronze"),
          iron: read("--forge-iron"),
          steel: read("--forge-steel"),
          spark: read("--forge-spark"),
          dark: read("--forge-dark"),
        }}
      />,
    );
    link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }, [choice.logo, choice.palette]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable], [role=grid]"))
        return;
      cycleForge(active, event.key === "ArrowRight" ? 1 : -1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  return (
    <div
      // Plain Geist and a fixed neutral so the bar never takes on the palette
      // it is switching — it is not part of the design under review.
      style={{ fontFamily: "Geist Variable, sans-serif" }}
      className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/20 bg-black/90 px-2 py-1 text-xs text-white shadow-2xl"
    >
      <span className="px-2 font-semibold tracking-wide text-amber-200">
        PROTOTYPE
      </span>
      {(Object.keys(FORGE_AXES) as ForgeAxis[]).map((axis) => {
        const value = choice[axis];
        const name = (FORGE_AXES[axis] as Record<string, string>)[value];
        return (
          <div
            key={axis}
            className={cn(
              "flex items-center rounded-full",
              active === axis && "bg-white/15",
            )}
          >
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-white hover:bg-white/20 hover:text-white"
              aria-label={`Previous ${AXIS_LABEL[axis]}`}
              onClick={() => {
                setActive(axis);
                cycleForge(axis, -1);
              }}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setActive(axis)}
              className="min-w-40 font-normal text-white hover:bg-white/20 hover:text-white"
            >
              <span className="text-white/60">{AXIS_LABEL[axis]}</span>
              <span className="font-medium">
                {value === "current" ? "" : `${value} · `}
                {name}
              </span>
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-white hover:bg-white/20 hover:text-white"
              aria-label={`Next ${AXIS_LABEL[axis]}`}
              onClick={() => {
                setActive(axis);
                cycleForge(axis, 1);
              }}
            >
              <ChevronRight />
            </Button>
          </div>
        );
      })}
      <a
        href="/__dev/forge"
        className="px-2 text-white/70 underline-offset-2 hover:text-white hover:underline"
      >
        Specimen
      </a>
    </div>
  );
}
