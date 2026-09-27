/**
 * PROTOTYPE — throwaway, lives only on `prototype/forge-rebrand`.
 *
 * Question: which logo, wordmark face and palette does "The Great Forge Desk"
 * ship with? Three independent axes, switchable from the floating bar in the
 * real app (`ForgeSwitcher`) and compared side by side at `/__dev/forge`.
 *
 * Choice comes from `?logo=&font=&palette=` on first load, then sessionStorage,
 * so it survives in-app navigation (which drops the search string).
 */
import { useSyncExternalStore } from "react";

export const FORGE_AXES = {
  logo: {
    current: "Current ticket",
    A: "Hot strike",
    B: "Spark arc",
    C: "Bronze coin",
    D: "Heavy anvil",
  },
  font: {
    current: "Geist (current)",
    A: "Marcellus SC · engraved",
    B: "Rokkitt · slab",
    C: "Archivo Expanded · grotesque",
  },
  palette: {
    current: "Current emerald",
    A: "Cold iron",
    B: "Warm granite",
    C: "Blackened steel",
  },
} as const;

export type ForgeAxis = keyof typeof FORGE_AXES;
export type ForgeChoice = { [K in ForgeAxis]: keyof (typeof FORGE_AXES)[K] };

const AXES = Object.keys(FORGE_AXES) as ForgeAxis[];
const STORAGE_KEY = "forge-prototype";
const DEFAULT: ForgeChoice = { logo: "A", font: "A", palette: "A" };

export const optionsOf = <K extends ForgeAxis>(axis: K) =>
  Object.keys(FORGE_AXES[axis]) as ForgeChoice[K][];

function isOption(axis: ForgeAxis, value: unknown): boolean {
  return typeof value === "string" && value in FORGE_AXES[axis];
}

function readInitial(): ForgeChoice {
  const choice = { ...DEFAULT };
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "{}");
    for (const axis of AXES)
      if (isOption(axis, saved[axis]))
        Object.assign(choice, { [axis]: saved[axis] });
  } catch {
    // Storage blocked or garbage — defaults are fine for a prototype.
  }
  const params = new URLSearchParams(window.location.search);
  for (const axis of AXES) {
    const value = params.get(axis);
    if (isOption(axis, value)) Object.assign(choice, { [axis]: value });
  }
  return choice;
}

let current: ForgeChoice = readInitial();
const listeners = new Set<() => void>();

function apply() {
  const root = document.documentElement;
  for (const axis of ["font", "palette"] as const) {
    const key = axis === "font" ? "forgeFont" : "forgePalette";
    if (current[axis] === "current") delete root.dataset[key];
    else root.dataset[key] = current[axis];
  }
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // ignore
  }
  const url = new URL(window.location.href);
  for (const axis of AXES) url.searchParams.set(axis, current[axis]);
  // Keep React Router's own history state, or its back/forward index breaks.
  window.history.replaceState(window.history.state, "", url);
}

export function setForge<K extends ForgeAxis>(axis: K, value: ForgeChoice[K]) {
  current = { ...current, [axis]: value };
  apply();
  listeners.forEach((l) => l());
}

export function cycleForge(axis: ForgeAxis, step: 1 | -1) {
  const options = optionsOf(axis);
  const index = options.indexOf(current[axis] as never);
  setForge(axis, options[(index + step + options.length) % options.length]);
}

export function useForge(): ForgeChoice {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}

apply();
