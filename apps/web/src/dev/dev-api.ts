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
import { useQuery } from "@tanstack/react-query";
import {
  DEVTOOLS_API,
  type ProjectGraph,
  type SuiteDescriptor,
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
