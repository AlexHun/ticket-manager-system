import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup, configure } from "@testing-library/react";
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

/**
 * RTL keeps its own async budget, and Vitest's `testTimeout` does not govern
 * it: `findBy*` and `waitFor` give up after **1000ms** regardless of the
 * 15s in `vite.config.ts`. That default is not survivable here. The suite
 * mounts data routers, so a `findBy*` is waiting on a loader to settle *and*
 * the first render behind it, and this machine class runs the web suite ~4x
 * slower than `ubuntu-latest` (see docs/standards/testing.md) with 32 files in
 * parallel. `TicketsPage.loader.test.tsx` was failing roughly two runs in three
 * at 1226ms with an empty `<body><div /></body>` — the router had simply not
 * rendered yet — which is a red suite that says nothing about the code.
 *
 * 5s, not more: it has to stay well under the 15s `testTimeout` so a genuinely
 * missing element still fails as RTL's own error, which names the query and
 * prints the DOM, rather than as a bare Vitest timeout that prints neither.
 *
 * Two files pass a per-call `timeout` (`Tutorial.test.tsx`, `TicketsPage.test.tsx`);
 * those were this same 1000ms default worked around one call site at a time,
 * and a per-call value still wins over this one where it is larger.
 */
configure({ asyncUtilTimeout: 5_000 });

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
