import type {
  EnsureQueryDataOptions,
  QueryClient,
  QueryKey,
} from "@tanstack/react-query";
import type { LoaderFunction, LoaderFunctionArgs } from "react-router-dom";
import { queryClient as appQueryClient } from "@/lib/query-client";

/**
 * The rule every prefetching route follows, written down once.
 *
 * A route loader here does the same four things whatever route it belongs to:
 * start the queries the URL implies, **await** them, **tolerate** a rejection,
 * and return **nothing**. Each of those is a decision with a reason, and each
 * reason is the same on all three routes:
 *
 * - **Awaited**, not fired and forgotten, because that is what removes the
 *   second loading state. React Router holds the previous screen until the
 *   loader settles, so the page mounts with its cache primed instead of
 *   mounting into a pending query and rendering its skeleton. The cost is that
 *   a slow API leaves the previous screen up with no cue that the click landed;
 *   the answer to that is a shared `useNavigation()` indicator, not a
 *   fire-and-forget loader.
 * - **Failure-tolerant**, because a failed prefetch is not a failed
 *   navigation. Every one of these pages owns its own error screen — an inline
 *   message above filters that still work, or "Ticket not found" with a way
 *   back — and a loader that threw would replace that with the router's error
 *   boundary, which offers neither. The component re-runs the query on mount
 *   (react-query's `retryOnMount` retries an errored entry for a new observer),
 *   so a broken destination costs one extra request on a path that renders no
 *   data either way — measured on `/tickets/<max id>`: 2 requests before these
 *   loaders existed, 3 after (both counts doubled by StrictMode's dev-only
 *   remount). That is the price of leaving the error screens where they were.
 * - **Several queries at once**, via `allSettled`: the pages that need more
 *   than one fire them concurrently on mount, so a loader that awaited them in
 *   sequence would move the fetch earlier and make it slower. `allSettled`
 *   keeps them parallel *and* keeps one failure from cancelling the wait on the
 *   others — which is the same failure tolerance the single-query case wants,
 *   so both arrive from one expression.
 * - **Returns `null`**, because `ensureQueryData` writes into the shared
 *   `QueryClient` and the page's hooks read it back through the same keys.
 *   react-query stays the cache layer; the loader moves only *when* the fetch
 *   starts (`docs/plans/route-level-data-prefetching.md`, R2). Nothing calls
 *   `useLoaderData` on these routes.
 *
 * A route supplies the one thing that is genuinely its own — which queries its
 * URL implies — and nothing else. Before #157 the four rules above were prose
 * repeated three times over four lines of code each, and all three routes
 * reached the module-level `queryClient` directly, so nothing could substitute
 * it and none of them had a test.
 *
 * Deliberately small, like the query modules it sits beside: the router imports
 * every loader statically, so anything this pulls in lands in the entry chunk.
 * `@/lib/query-client` is already there — `main.tsx` mounts the provider from
 * it — and the react-router import is types only, so it erases.
 */

/**
 * One query a route wants started, with its client not yet decided.
 *
 * A closure rather than the options object itself, and that is a type
 * constraint rather than a preference: `queryOptions(...)` returns options
 * carrying the query's own key tuple and response type, and those appear in
 * *contravariant* positions inside react-query's option types (`staleTime`'s
 * function form takes a `Query<…>`), so a list of differently-typed options
 * has no supertype to be an array of — the dashboard's three would need
 * `EnsureQueryDataOptions<any, any, any, any>` to sit side by side. Binding
 * each one through `prefetchQuery` instead keeps every query fully typed at the
 * call site and leaves this module with a homogeneous list.
 */
export interface PrefetchableQuery {
  ensure: (client: QueryClient) => Promise<unknown>;
}

/**
 * Name a query for a route to prefetch: `prefetchQuery(ticketListQueryOptions(…))`.
 *
 * Takes exactly what `queryClient.ensureQueryData` takes — the generics are
 * react-query's own, so passing something that is not a query, or options whose
 * `queryFn` does not match its key, is a type error at the route.
 */
export function prefetchQuery<
  TQueryFnData,
  TError,
  TData,
  TQueryKey extends QueryKey,
>(
  options: EnsureQueryDataOptions<TQueryFnData, TError, TData, TQueryKey>,
): PrefetchableQuery {
  return { ensure: (client) => client.ensureQueryData(options) };
}

/**
 * Which queries a URL implies. Given the same `LoaderFunctionArgs` React Router
 * hands a loader, so a route reads `request.url` or `params` exactly as it did
 * inline — and reads them through the very parser its page reads
 * `useSearchParams` with, which is what keeps a hand-edited `?sort=nonsense`
 * priming the entry the page then reads instead of a neighbouring one.
 */
export type PrefetchQueries = (
  args: LoaderFunctionArgs,
) => readonly PrefetchableQuery[];

/**
 * The client route loaders prime. The app's own, except in a test that
 * substituted one — see `setPrefetchQueryClient`.
 */
let prefetchClient: QueryClient = appQueryClient;

/**
 * Point route loaders at another `QueryClient`.
 *
 * The seam #157 exists to open: a loader that reached `@/lib/query-client`
 * directly primed the app-wide singleton, so a test could mount the route but
 * never see what the loader put in the cache its page reads from — and whatever
 * it did prime stayed there for every file that ran afterwards.
 * `renderRoutes` (`@/test/render`) calls this with the client it creates, and
 * `@/test/setup.ts` restores the app's after every test, so a test that renders
 * a route gets the seam wired for free; `runLoader` (`@/test/run-loader`) does
 * the same for a loader called without a DOM.
 *
 * Test-only, but it lives here rather than in `@/test` because the variable it
 * writes is this module's.
 */
export function setPrefetchQueryClient(client: QueryClient): void {
  prefetchClient = client;
}

/** Back to the app's own client. Called from the suite-wide `afterEach`. */
export function resetPrefetchQueryClient(): void {
  prefetchClient = appQueryClient;
}

/**
 * A route loader that primes the queries its URL implies.
 *
 * ```ts
 * export const ticketDetailLoader = prefetchLoader(({ params }) => [
 *   prefetchQuery(ticketDetailQueryOptions(params.id ?? "")),
 * ]);
 * ```
 */
export function prefetchLoader(queries: PrefetchQueries): LoaderFunction {
  return async (args) => {
    await Promise.allSettled(
      queries(args).map((query) => query.ensure(prefetchClient)),
    );
    return null;
  };
}
