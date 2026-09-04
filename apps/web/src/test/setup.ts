import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { resetPrefetchQueryClient } from "@/lib/route-prefetch";

/**
 * jsdom implements neither the Pointer Capture API, `scrollIntoView`, nor
 * `ResizeObserver`. Radix primitives that render a floating layer (Select,
 * DropdownMenu, Popover, Combobox) call all three while opening, so without
 * these they throw instead of showing their content.
 */
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

/**
 * jsdom has no `matchMedia` either. shadcn's `useIsMobile` — which the sidebar
 * depends on — calls it unguarded, so anything rendering the app shell throws
 * without this.
 *
 * `matches` is deliberately not a blanket `false`. `use-reduced-motion.ts`
 * guards its own call and defaults to *reduced* precisely because this shim was
 * absent; answering `false` to everything would quietly switch animation on
 * across the suite and make any test touching a StatTile depend on animation
 * frames. So reduced-motion stays on, and every other query — including the
 * sidebar's `(max-width: 767px)` — answers no, i.e. desktop.
 */
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      media: query,
      matches: query.includes("prefers-reduced-motion"),
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    }) as MediaQueryList;
}

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
  },
  Toaster: () => null,
}));

afterEach(() => {
  cleanup();
  /**
   * Route loaders prime whichever client `renderRoutes` last created, or one a
   * test set by hand; put the app's back so the next test starts from the same
   * state as the first. Harmless in a file that mounts no route — it is an
   * assignment, and nothing here imports a loader unless it uses one.
   */
  resetPrefetchQueryClient();
});
