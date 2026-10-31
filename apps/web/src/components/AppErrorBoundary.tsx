import { useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouteError } from "react-router-dom";
import { ROUTE } from "@/lib/routes";
import {
  isReplaced,
  releaseQueryOptions,
  reloadOnceFor,
} from "@/lib/release-check";
import { Sentry } from "@/lib/sentry";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * The app's error boundary, wrapped around everything below the providers.
 * Errors inside a route reach it through `RethrowRouteError`.
 *
 * It exists for a failure this repo has already had rather than for a
 * hypothetical one. A React render error unmounts the entire tree, so before
 * this the app answered a stray `<SelectLabel>` outside a `<SelectGroup>` — a
 * throw from a Radix primitive, noted in `apps/web/CLAUDE.md` — by going white,
 * with the reason visible only in a console nobody had open. A blank page is the
 * worst possible error report: the agent cannot say what happened and nothing
 * was recorded.
 *
 * `Sentry.ErrorBoundary` does both halves — the fallback below replaces the
 * white screen, and the error is reported with its component stack, which is the
 * part a plain stack trace lacks and the part that names the offending
 * component.
 *
 * It is deliberately *not* per-route. A boundary around each page would keep the
 * chrome alive and look tidier, but it also lets a broken page fail quietly in a
 * corner; one at the top is honest about the fact that the app is in an unknown
 * state.
 *
 * A tab left open across a deploy lands here too (#452), so the fallback asks
 * which release the server runs and reloads once if it is not this tab's.
 */
export function AppErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <Sentry.ErrorBoundary
      fallback={({ resetError }) => (
        <div className="flex min-h-svh items-center justify-center p-6">
          <ReloadIfReplaced />
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Couldn't show this page</CardTitle>
              <CardDescription>
                The details have been recorded. Try again, or go back to the
                dashboard.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Button onClick={resetError}>Try again</Button>
              <Button
                variant="outline"
                onClick={() => {
                  // A full page load rather than a router navigation, on
                  // purpose: what threw may be the router or the query cache,
                  // and only a reload starts both again from nothing.
                  window.location.href = ROUTE.dashboard.path;
                }}
              >
                Back to dashboard
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    >
      {children}
    </Sentry.ErrorBoundary>
  );
}

/**
 * Reloads the page once when the server runs a release other than this tab's.
 *
 * `staleTime: 0` so a crash asks afresh rather than trusting what
 * `NewReleaseToast` cached up to the app's `staleTime` ago.
 */
function ReloadIfReplaced() {
  const { data: served } = useQuery({ ...releaseQueryOptions(), staleTime: 0 });

  useEffect(() => {
    if (served && isReplaced(served)) reloadOnceFor(served);
  }, [served]);

  return null;
}

/**
 * The root route's `ErrorBoundary`: rethrows what the router caught, so it
 * reaches `AppErrorBoundary` above `RouterProvider`.
 *
 * Without it a data router renders its own error page for anything a route
 * throws, a failed lazy import included, and `AppErrorBoundary` saw none of it:
 * #451's crash showed React Router's "Unexpected Application Error!". A throw
 * from an error boundary's own render passes to the boundary above it.
 */
export function RethrowRouteError(): never {
  throw useRouteError();
}
