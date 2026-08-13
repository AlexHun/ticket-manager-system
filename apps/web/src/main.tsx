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
      // On, because the work this app does is not all done by the person
      // looking at it. Tickets arrive by webhook, the classifier files them,
      // the auto-reply answers some of them outright, and a colleague can
      // reassign one — none of which the tab hears about. With this off, an
      // open list showed the queue as it stood when the tab was last
      // navigated: come back after lunch and the rows were the pre-lunch rows.
      //
      // `staleTime` is the throttle that makes this affordable. A focus only
      // refetches data already older than 30s, so alt-tabbing repeatedly costs
      // nothing, and the dashboard's eight-query stats endpoint is not re-run
      // on every glance at the window.
      refetchOnWindowFocus: true,
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
