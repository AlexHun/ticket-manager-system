import { screen, waitFor } from "@testing-library/react";
import { QueryClient, queryOptions } from "@tanstack/react-query";
import { useLoaderData } from "react-router-dom";
import { describe, expect, test, vi } from "vitest";
import { queryClient as appQueryClient } from "@/lib/query-client";
import { renderRoutes } from "@/test/render";
import { runLoader } from "@/test/run-loader";
import { prefetchLoader, prefetchQuery } from "./route-prefetch";

/**
 * The rule the three prefetching routes share, tested once — which is the point
 * of #157. Nothing here names an endpoint or a page: the queries are stand-ins,
 * because what is under test is what a loader does with whatever it is given.
 * What each route actually asks for is its own loader's test.
 */

/** A query whose fetch this test finishes by hand, so "awaited" is observable. */
function deferredQuery(key: string) {
  let settle: ((value: string) => void) | undefined;
  let fail: ((error: Error) => void) | undefined;

  const queryFn = vi.fn(
    () =>
      new Promise<string>((resolve, reject) => {
        settle = resolve;
        fail = reject;
      }),
  );

  return {
    queryFn,
    options: queryOptions({ queryKey: [key], queryFn, retry: false }),
    resolve: (value: string) => settle?.(value),
    reject: (error: Error) => fail?.(error),
  };
}

const HYDRATING = "Hydrating";
const ARRIVED = "Arrived";

/**
 * Let every already-settled promise chain run. Enough for a loader built on
 * `Promise.all` to have rejected and handed the navigation on — which is what
 * the "still hydrating" assertions below would catch.
 */
function settleQueue() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * A client that keeps what the loader primed, unlike the suite's default one.
 *
 * `createTestQueryClient` sets `gcTime: 0` so nothing carries between tests, and
 * an entry with no observer is collected the moment it settles — which is every
 * entry here, since these routes render a `<p>`, not a page with a `useQuery`.
 * The pages do observe theirs, so this is a fact about the stand-ins, not about
 * the loaders.
 */
function cacheKeepingClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
}

describe("prefetchLoader", () => {
  test("awaits its queries, so the page mounts with the cache primed", async () => {
    const thing = deferredQuery("thing");

    const { queryClient } = renderRoutes(
      [
        {
          path: "/",
          loader: prefetchLoader(() => [prefetchQuery(thing.options)]),
          HydrateFallback: () => <p>{HYDRATING}</p>,
          Component: () => <p>{ARRIVED}</p>,
        },
      ],
      { queryClient: cacheKeepingClient() },
    );

    // Fired, but not finished: the router is still holding the previous screen,
    // which on a first load is the `HydrateFallback`.
    await waitFor(() => expect(thing.queryFn).toHaveBeenCalled());
    expect(screen.getByText(HYDRATING)).toBeInTheDocument();

    thing.resolve("primed");

    expect(await screen.findByText(ARRIVED)).toBeInTheDocument();
    // Fire-and-forget would have mounted the page above with this still empty,
    // which is the skeleton-after-fallback sequence the loaders exist to remove.
    expect(queryClient.getQueryData(["thing"])).toBe("primed");
  });

  test("lets the navigation complete when a query rejects", async () => {
    const broken = deferredQuery("broken");

    renderRoutes([
      {
        path: "/",
        loader: prefetchLoader(() => [prefetchQuery(broken.options)]),
        HydrateFallback: () => <p>{HYDRATING}</p>,
        Component: () => <p>{ARRIVED}</p>,
        // The page owns this route's error screen. If the loader rethrew, the
        // router would render this instead and the reader would lose every way
        // back that the page offers.
        ErrorBoundary: () => <p>Router error boundary</p>,
      },
    ]);

    await waitFor(() => expect(broken.queryFn).toHaveBeenCalled());
    broken.reject(new Error("Request failed with status code 500"));

    expect(await screen.findByText(ARRIVED)).toBeInTheDocument();
    expect(screen.queryByText("Router error boundary")).not.toBeInTheDocument();
  });

  test("starts several queries together and waits for all of them", async () => {
    const first = deferredQuery("first");
    const second = deferredQuery("second");

    const { queryClient } = renderRoutes(
      [
        {
          path: "/",
          loader: prefetchLoader(() => [
            prefetchQuery(first.options),
            prefetchQuery(second.options),
          ]),
          HydrateFallback: () => <p>{HYDRATING}</p>,
          Component: () => <p>{ARRIVED}</p>,
        },
      ],
      { queryClient: cacheKeepingClient() },
    );

    // Both are in flight while neither has settled. Awaiting them one after the
    // other would leave the second unasked until the first came back — earlier
    // than the page would have asked, and slower than the page asking itself.
    await waitFor(() => expect(second.queryFn).toHaveBeenCalled());
    expect(first.queryFn).toHaveBeenCalled();
    expect(screen.getByText(HYDRATING)).toBeInTheDocument();

    first.resolve("one");
    await settleQueue();
    expect(screen.getByText(HYDRATING)).toBeInTheDocument();

    second.resolve("two");

    expect(await screen.findByText(ARRIVED)).toBeInTheDocument();
    expect(queryClient.getQueryData(["first"])).toBe("one");
    expect(queryClient.getQueryData(["second"])).toBe("two");
  });

  test("keeps one query's failure from cancelling the wait on the others", async () => {
    const broken = deferredQuery("broken");
    const good = deferredQuery("good");

    const { queryClient } = renderRoutes(
      [
        {
          path: "/",
          loader: prefetchLoader(() => [
            prefetchQuery(broken.options),
            prefetchQuery(good.options),
          ]),
          HydrateFallback: () => <p>{HYDRATING}</p>,
          Component: () => <p>{ARRIVED}</p>,
        },
      ],
      { queryClient: cacheKeepingClient() },
    );

    await waitFor(() => expect(good.queryFn).toHaveBeenCalled());
    broken.reject(new Error("Request failed with status code 500"));
    await settleQueue();

    // `Promise.all` would have rejected here and let the navigation finish with
    // nothing primed; the panel that could have rendered would render a
    // skeleton instead, because its data was still on the wire.
    expect(screen.getByText(HYDRATING)).toBeInTheDocument();

    good.resolve("kept");

    expect(await screen.findByText(ARRIVED)).toBeInTheDocument();
    expect(queryClient.getQueryData(["good"])).toBe("kept");
  });

  test("returns nothing to the route", async () => {
    const thing = deferredQuery("thing");
    thing.queryFn.mockImplementation(() => Promise.resolve("primed"));

    function LoaderData() {
      return <p>{`Loader data: ${String(useLoaderData())}`}</p>;
    }

    renderRoutes([
      {
        path: "/",
        loader: prefetchLoader(() => [prefetchQuery(thing.options)]),
        Component: LoaderData,
      },
    ]);

    // react-query is the cache layer, not the route: the data reaches the page
    // through `useQuery` reading the entry the loader primed.
    expect(await screen.findByText("Loader data: null")).toBeInTheDocument();
  });

  test("primes the query client a test substitutes", async () => {
    const thing = deferredQuery("thing");
    thing.queryFn.mockImplementation(() => Promise.resolve("primed"));

    const substitute = new QueryClient();

    await runLoader(prefetchLoader(() => [prefetchQuery(thing.options)]), "/", {
      queryClient: substitute,
    });

    // The seam #157 opened. Reaching `@/lib/query-client` directly, as the three
    // loaders used to, meant a test could call a loader and see nothing of what
    // it had done — and that the app's own client kept whatever the test primed
    // into it, for every file that ran afterwards.
    expect(substitute.getQueryData(["thing"])).toBe("primed");
    expect(appQueryClient.getQueryData(["thing"])).toBeUndefined();
  });
});
