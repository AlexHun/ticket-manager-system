// Before the app is imported, so anything that throws while a module is
// evaluating is still reported. Inert without `VITE_SENTRY_DSN`.
import "@/lib/sentry";

import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { router } from "./App";
import { queryClient } from "@/lib/query-client";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { Toaster } from "@/components/ui/sonner";
import "./index.css";

// PROTOTYPE (forge rebrand) — see src/prototype/forge/forge-proto.ts.
const ForgeSwitcher = import.meta.env.DEV
  ? lazy(() =>
      import("./prototype/forge/forge-proto.css").then(() =>
        import("./prototype/forge/ForgeSwitcher").then((m) => ({
          default: m.ForgeSwitcher,
        })),
      ),
    )
  : null;

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing #root element");

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* Inside the providers, not outside: the fallback is a themed shadcn
          card, and "Try again" is only useful if the query client below it
          survived to retry with. Outside them the boundary would catch the same
          errors and render an unstyled page. */}
      <AppErrorBoundary>
        <RouterProvider router={router} />
      </AppErrorBoundary>
      <Toaster />
      {/* PROTOTYPE (forge rebrand) — dev only; folds away in a build. */}
      {ForgeSwitcher && (
        <Suspense fallback={null}>
          <ForgeSwitcher />
        </Suspense>
      )}
    </QueryClientProvider>
  </StrictMode>,
);
