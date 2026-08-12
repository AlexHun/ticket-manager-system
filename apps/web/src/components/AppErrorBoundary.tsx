import type { ReactNode } from "react";
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
 * The app's only error boundary, wrapped around everything below the providers.
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
 */
export function AppErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <Sentry.ErrorBoundary
      fallback={({ resetError }) => (
        <div className="flex min-h-svh items-center justify-center p-6">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Something broke</CardTitle>
              <CardDescription>
                This page hit an error it could not recover from. The details
                have been recorded.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Button onClick={resetError}>Try again</Button>
              <Button
                variant="outline"
                onClick={() => {
                  window.location.href = "/";
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
