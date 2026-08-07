import { Loader2 } from "lucide-react";

/**
 * The holding screen for a route that can't render yet — either its code is
 * still downloading (the `Suspense` boundary in `App.tsx`) or its session check
 * hasn't answered (`ProtectedRoute` / `AdminRoute`).
 *
 * One component for both on purpose: they happen back to back on a cold load,
 * and two different-looking placeholders would read as two separate waits.
 *
 * Deliberately not a skeleton. It stands in for four pages with quite different
 * layouts, so any shape it borrowed from one of them would jump when a
 * different page arrived. Each page still renders its own matching skeleton
 * from its `isPending` branch once its code is here — this only covers the
 * moment before that, which is much shorter.
 */
export function RouteFallback() {
  return (
    <div className="grid min-h-dvh place-items-center" aria-busy="true">
      <Loader2
        className="size-6 animate-spin text-muted-foreground"
        aria-label="Loading"
      />
    </div>
  );
}
