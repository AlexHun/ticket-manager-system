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
import { DEVTOOLS_API } from "./devtools-paths";
import type { ProjectGraph } from "./map-protocol";
import type { SuiteDescriptor } from "./test-run-protocol";
import type { UsageReport } from "./usage-protocol";

const devApi = axios.create({ baseURL: "" });

export const devKeys = {
  graph: ["dev", "graph"] as const,
  suites: ["dev", "suites"] as const,
  storedUsage: ["dev", "usage", "stored"] as const,
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
 * The stored reading the Usage page opens on (#432): figures computed from the
 * usage history by `GET`, reading no transcript and writing nothing — or null
 * when there is no history, or it holds no rows.
 *
 * A query, unlike the scan below, because it is safe for react-query to run
 * for you: on mount, on focus, on a reconnect, it only re-tallies what is
 * stored. `gcTime: 0` drops the entry when the page unmounts, so coming back
 * asks the server again rather than showing a reading from before the last
 * scan or push; `retry: false` so a failure is on screen as a warning at once
 * rather than after three attempts.
 */
export function useStoredUsage() {
  return useQuery({
    queryKey: devKeys.storedUsage,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      const { data } = await devApi.get<UsageReport | null>(
        DEVTOOLS_API.usage,
        { signal },
      );
      return data;
    },
  });
}

/**
 * One reading of this machine's transcripts, taken on demand.
 *
 * A mutation rather than a query, and the choice is the feature: a scan reads
 * every transcript and asks `gh`, so it runs when Scan is pressed and never
 * because react-query decided to — on mount, on window focus, on a reconnect.
 * A mutation runs exactly when `mutate()` is called and holds its `data` until
 * the next call, which is "press Scan, keep the figures until the next press"
 * stated in the library's own terms. What the page shows before the first
 * press is `useStoredUsage` above (#432), which reads the history instead.
 */
export function useUsageScan() {
  return useMutation({
    mutationFn: async () => {
      const { data } = await devApi.post<UsageReport>(DEVTOOLS_API.usage);
      return data;
    },
  });
}
