import type { QueryClient } from "@tanstack/react-query";
import type { LoaderFunction, Params } from "react-router-dom";
import { setPrefetchQueryClient } from "@/lib/route-prefetch";
import { createTestQueryClient } from "@/test/render";

interface RunLoaderOptions {
  /** The route params React Router would have matched, e.g. `{ id: "12" }`. */
  params?: Params;
  /**
   * The route pattern that matched, e.g. `/tickets/:id`. Nothing here reads it —
   * React Router passes it for logging — so it defaults to the path itself.
   */
  pattern?: string;
  /** Prime this client instead of a fresh one — e.g. one a render already made. */
  queryClient?: QueryClient;
}

export interface RunLoaderResult {
  /** What the loader returned. `null` for every prefetching route (#157). */
  data: unknown;
  /** The client it primed, to read the cache back out of. */
  queryClient: QueryClient;
}

/**
 * Call a route's loader the way the router would, and read back what it primed.
 *
 * `renderRoutes` is the right tool when the question involves the page — what
 * the reader sees, or whether the navigation completed. This is for the
 * narrower question of what a loader *requests*, which needs no DOM: it builds
 * the `request`/`params` pair React Router hands a loader, points the
 * prefetching loaders at a test `QueryClient` (`setPrefetchQueryClient`,
 * restored by the suite-wide `afterEach` in `@/test/setup.ts`) and awaits it.
 *
 * ```ts
 * const { queryClient } = await runLoader(ticketDetailLoader, "/tickets/12", {
 *   params: { id: "12" },
 * });
 * ```
 *
 * `url` may be relative; loaders read `request.url` through `new URL(...)`, so
 * it is resolved against an arbitrary origin the same way the browser's would
 * be. `params` is not derived from it — the router matches those against the
 * route pattern, and a test says which pattern it means by passing them.
 */
export async function runLoader(
  loader: LoaderFunction,
  url: string,
  { params = {}, pattern, queryClient }: RunLoaderOptions = {},
): Promise<RunLoaderResult> {
  const client = queryClient ?? createTestQueryClient();
  setPrefetchQueryClient(client);

  const resolved = new URL(url, "http://localhost");
  const data = await loader({
    request: new Request(resolved.toString()),
    url: resolved,
    pattern: pattern ?? resolved.pathname,
    params,
    context: undefined,
  });

  return { data, queryClient: client };
}
