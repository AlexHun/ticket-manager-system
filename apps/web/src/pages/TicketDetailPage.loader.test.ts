import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ticketKeys } from "@/lib/ticket-queries";
import { apiStub } from "@/test/api-stub";
import { runLoader } from "@/test/run-loader";
import { ticketDetailLoader } from "./TicketDetailPage.loader";

/**
 * What `/tickets/:id` prefetches. The rule it follows once it has that query —
 * await, tolerate, return nothing — belongs to `prefetchLoader` and is tested
 * in `@/lib/route-prefetch.test.tsx`.
 */

vi.mock("@/lib/api", () => import("@/test/api-stub"));

const ticketGet = apiStub.get("/api/tickets/:id");

/**
 * Keeps what the loader primed, where the suite's default client collects an
 * unobserved entry as soon as it settles (`gcTime: 0`). Nothing observes
 * anything here — no page is mounted.
 */
function cacheKeepingClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
}

beforeEach(() => {
  apiStub.reset();
});

describe("ticketDetailLoader", () => {
  test("requests the ticket the route matched", async () => {
    ticketGet.mockResolvedValue({ data: { ticket: { id: 12 } } });

    const { queryClient } = await runLoader(ticketDetailLoader, "/tickets/12", {
      params: { id: "12" },
      queryClient: cacheKeepingClient(),
    });

    expect(ticketGet).toHaveBeenCalledTimes(1);
    expect(ticketGet.mock.calls[0][0]).toBe("/api/tickets/12");
    // Under the key the page's own `useQuery` reads, so it mounts with the
    // ticket already there and never renders its skeleton.
    expect(queryClient.getQueryData(ticketKeys.detail("12"))).toEqual({
      id: 12,
    });
  });

  test("returns null even when the request fails", async () => {
    ticketGet.mockRejectedValue(new Error("Request failed with status code 404"));

    const { data } = await runLoader(ticketDetailLoader, "/tickets/999999", {
      params: { id: "999999" },
    });

    // The page owns "Ticket not found" and the way back from it; a loader that
    // rethrew would hand the navigation to the router's error boundary instead.
    expect(data).toBeNull();
  });
});
