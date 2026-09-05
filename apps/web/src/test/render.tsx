import type { ReactNode } from "react";
import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import {
  RouterProvider,
  createMemoryRouter,
  type InitialEntry,
  type RouteObject,
} from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { setPrefetchQueryClient } from "@/lib/route-prefetch";

type RenderRoutesOptions = Omit<RenderOptions, "wrapper"> & {
  /**
   * The history the router starts on. Defaults to ["/"]. Entries may be
   * objects rather than plain paths, which is how a test supplies router
   * `state` (e.g. the list query string a detail page reads for its back link).
   * The last entry is the entry URL — under `renderRoutes` it is also what
   * decides which route matches.
   */
  initialEntries?: InitialEntry[];
  /** Provide your own QueryClient (e.g. to assert cache state). */
  queryClient?: QueryClient;
};

/**
 * The client `renderRoutes` mounts, and the one `runLoader` primes when a test
 * calls a route's loader without rendering it — same settings either way, so
 * what a loader put in the cache and what a page reads out of it are the same
 * question.
 */
export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

/**
 * The providers every page needs above the router.
 *
 * `TooltipProvider` is here for `Hint`, which is sprinkled through the tables —
 * Radix throws outright without one above it, the same reason `AppShell` mounts
 * one.
 */
function TestProviders({
  client,
  children,
}: {
  client: QueryClient;
  children: ReactNode;
}) {
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={0}>{children}</TooltipProvider>
    </QueryClientProvider>
  );
}

/** The router `renderRoutes` mounts — a data router, as `App.tsx` builds. */
export type TestRouter = ReturnType<typeof createMemoryRouter>;

export interface RenderRoutesResult extends RenderResult {
  queryClient: QueryClient;
  /**
   * The live router. `router.state.location` is the app's own answer to "where
   * are we now", which is what a test asserting URL state should read rather
   * than a probe component rendered beside the page; `router.state.navigation`
   * is how a pending indicator's subject becomes observable at all.
   */
  router: TestRouter;
}

/**
 * Render routes on a data router, the kind the app actually runs on. This is
 * the web suite's only render helper — a `MemoryRouter` one lived beside it
 * until #159, and every test that used it now mounts a single route here.
 *
 * `App.tsx` builds a `createBrowserRouter` whose routes carry `loader`s,
 * `lazy` components and a `HydrateFallback`; the component router supports none
 * of those, so everything the data-router and prefetch work added was reachable
 * only from E2E. This is the same router in its memory form, so a component
 * test can mount a route the way a navigation would: the entry URL decides
 * which route matches, a `loader` runs before the component renders, and
 * `useNavigation()` reports the pending state in between.
 *
 * Routes are supplied by the caller rather than imported from `App.tsx` — a
 * test says which slice of the tree it is about, and pays for that slice only.
 * Give them the real shape (`{ path, loader, Component }`) and they behave the
 * way the app's do.
 *
 * ```ts
 * const { router } = renderRoutes(
 *   [{ path: "/tickets", loader: ticketsLoader, Component: TicketsPage }],
 *   { initialEntries: ["/tickets?status=Open"] },
 * );
 * ```
 *
 * A test about a component rather than a page mounts it as the one route the
 * default entry URL matches, which costs a line and buys the same router the
 * rest of the suite reasons about:
 *
 * ```ts
 * renderRoutes([{ path: "/", element: <ChangelogPopover /> }]);
 * ```
 *
 * Returns synchronously, mid-initialization if the routes have loaders — that
 * is deliberate, because the first paint is exactly what a pending-state test
 * is about. Await something (`findBy…`, `waitFor`) to see past it.
 *
 * A route's real `loader` may be mounted here as-is: the app's prefetching
 * loaders are pointed at the client below for the duration of the test
 * (`setPrefetchQueryClient`, restored by the suite-wide `afterEach` in
 * `@/test/setup.ts`), so what a loader primes is what the page then reads —
 * rather than landing in the app-wide singleton no test can see (#157).
 */
export function renderRoutes(
  routes: RouteObject[],
  { initialEntries = ["/"], queryClient, ...options }: RenderRoutesOptions = {},
): RenderRoutesResult {
  const client = queryClient ?? createTestQueryClient();
  setPrefetchQueryClient(client);
  const router = createMemoryRouter(routes, { initialEntries });

  const result = render(
    <TestProviders client={client}>
      <RouterProvider router={router} />
    </TestProviders>,
    options,
  );

  return { ...result, queryClient: client, router };
}
