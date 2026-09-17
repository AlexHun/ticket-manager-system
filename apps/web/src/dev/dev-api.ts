/**
 * Talking to the dev middleware.
 *
 * Deliberately *not* the shared instance from `@/lib/api`: that one is pointed at
 * the Express API through `VITE_API_URL`, and these endpoints are served by the
 * Vite dev server itself — same origin as the page, no credentials, no base URL.
 * Sending them through the app's instance would aim them at :3001 and 404.
 *
 * Everything else follows the app's convention: axios, wrapped in react-query,
 * with the query's `signal` handed to axios so a navigation cancels the request.
 */

import axios from "axios";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  DEVTOOLS_API,
  type ProjectGraph,
  type SuiteDescriptor,
  type UsageReport,
} from "./protocol";

const devApi = axios.create({ baseURL: "" });

export const devKeys = {
  graph: ["dev", "graph"] as const,
  suites: ["dev", "suites"] as const,
};

/**
 * The project graph.
 *
 * `staleTime: 0` overrides the app-wide 30s: the whole point is to describe the
 * tree as it is right now, and editing a file is exactly when you would reload
 * this page. The scan costs ~110ms, so there is nothing to protect.
 */
export function useProjectGraph() {
  return useQuery({
    queryKey: devKeys.graph,
    staleTime: 0,
    queryFn: async ({ signal }) => {
      const { data } = await devApi.get<ProjectGraph>(DEVTOOLS_API.graph, {
        signal,
      });
      return data;
    },
  });
}

export function useSuites() {
  return useQuery({
    queryKey: devKeys.suites,
    queryFn: async ({ signal }) => {
      const { data } = await devApi.get<{ suites: SuiteDescriptor[] }>(
        DEVTOOLS_API.suites,
        { signal },
      );
      return data.suites;
    },
  });
}

/**
 * One reading of this machine's transcripts, taken on demand.
 *
 * A mutation rather than a query, and the choice is the feature: R5 says the
 * page gathers nothing until asked, and a query is a thing react-query is
 * entitled to run for you — on mount, on window focus, on a reconnect. A
 * mutation runs exactly when `mutate()` is called and holds its `data` until
 * the next call, which is "press Scan, keep the figures until the next press"
 * stated in the library's own terms. `useQuery({ enabled: false })` would be
 * the same behaviour spelled as a suppression of the default one — and it would
 * still take a query key, which is a cache entry, which is the thing
 * `UsageReport` in `./protocol` explains this feature must not have.
 */
export function useUsageScan() {
  return useMutation({
    mutationFn: async () => {
      const { data } = await devApi.post<UsageReport>(DEVTOOLS_API.usage);
      return data;
    },
  });
}
