// Before the app is imported, so anything that throws while a module is
// evaluating is still reported. Inert without `VITE_SENTRY_DSN`.
import "@/lib/sentry";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { Toaster } from "@/components/ui/sonner";
import "./index.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing #root element");

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* Inside the providers, not outside: the fallback is a themed shadcn
          card, and "Try again" is only useful if the query client below it
          survived to retry with. Outside them the boundary would catch the same
          errors and render an unstyled page. */}
      <AppErrorBoundary>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AppErrorBoundary>
      <Toaster />
    </QueryClientProvider>
  </StrictMode>,
);
