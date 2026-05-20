import type { ReactElement } from "react";
import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

type RenderWithQueryOptions = Omit<RenderOptions, "wrapper"> & {
  /** Routes the MemoryRouter starts on. Defaults to ["/"]. */
  initialEntries?: string[];
  /** Provide your own QueryClient (e.g. to assert cache state). */
  queryClient?: QueryClient;
};

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

export interface RenderWithQueryResult extends RenderResult {
  queryClient: QueryClient;
}

/**
 * Render a component inside the providers every page needs: a fresh
 * QueryClient (no retries, no cache carry-over between tests) and a
 * MemoryRouter so react-router hooks resolve.
 */
export function renderWithQuery(
  ui: ReactElement,
  { initialEntries = ["/"], queryClient, ...options }: RenderWithQueryOptions = {},
): RenderWithQueryResult {
  const client = queryClient ?? createTestQueryClient();

  const result = render(ui, {
    ...options,
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
      </QueryClientProvider>
    ),
  });

  return { ...result, queryClient: client };
}
