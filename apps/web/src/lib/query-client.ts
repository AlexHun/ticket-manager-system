import { QueryClient } from "@tanstack/react-query";

/**
 * The one QueryClient for the app, shared by `main.tsx`'s
 * `QueryClientProvider` and — from slice 2 onward — the per-route loader
 * modules that call `queryClient.ensureQueryData(...)` before their page's
 * chunk has even finished downloading. Living in its own module means a
 * loader can import just this, not `main.tsx` and everything it pulls in.
 */
export const queryClient = new QueryClient({
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
