import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  DEFAULT_PAGE_SIZE,
  DEFAULT_TICKET_SORT,
  FIRST_PAGE,
  SORT_ORDER,
  TICKET_CATEGORY,
  TICKET_SORT_FIELD,
  TICKET_STATUS,
  USER_ROLE,
  type TicketsListResponse,
  type TicketWithAssignee,
} from "@ticket/shared";
import { apiStub } from "@/test/api-stub";
import { renderRoutes } from "@/test/render";
import { runLoader } from "@/test/run-loader";
import { TicketsPage } from "./TicketsPage";
import { ticketsLoader } from "./TicketsPage.loader";

/**
 * What `/tickets` prefetches, and that it is the same query the page reads.
 *
 * The awaiting, the failure tolerance and the empty return are
 * `route-prefetch.test.tsx`'s subject now; what is left here is this route's
 * own half — which query its URL implies.
 */

vi.mock("@/lib/api", () => import("@/test/api-stub"));

const ticketsGet = apiStub.get("/api/tickets");

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({
    data: { user: { name: "Aaron Agent", role: USER_ROLE.agent } },
    isPending: false,
  }),
  authClient: { signOut: vi.fn() },
}));

function ticketsResponse(subject: string): { data: TicketsListResponse } {
  const ticket: TicketWithAssignee = {
    id: 1,
    subject,
    status: TICKET_STATUS.Open,
    category: null,
    customerEmail: "customer@example.com",
    customerName: "Casey Customer",
    assignedToId: null,
    assignedTo: null,
    lastMessageAt: "2025-05-01T12:00:00.000Z",
    createdAt: "2025-05-01T12:00:00.000Z",
    updatedAt: "2025-05-01T12:00:00.000Z",
  };

  return {
    data: {
      tickets: [ticket],
      total: 1,
      page: FIRST_PAGE,
      pageSize: DEFAULT_PAGE_SIZE,
    },
  };
}

/** The params one recorded `GET /api/tickets` was sent with. */
function paramsOfCall(index: number): unknown {
  const config = ticketsGet.mock.calls[index]?.[1] as
    | { params?: unknown }
    | undefined;
  return config?.params;
}

beforeEach(() => {
  apiStub.reset();
});

describe("ticketsLoader", () => {
  test("requests the page of tickets the URL asks for", async () => {
    ticketsGet.mockResolvedValue(ticketsResponse("Cannot log in"));

    await runLoader(
      ticketsLoader,
      `/tickets?status=${TICKET_STATUS.Open}&category=${TICKET_CATEGORY.Refund}&q=login&sort=${TICKET_SORT_FIELD.subject}&order=${SORT_ORDER.asc}&page=3&pageSize=50`,
    );

    expect(ticketsGet).toHaveBeenCalledTimes(1);
    // Every filter the URL carried, and nothing it didn't: `assignedTo` is
    // absent rather than sent as a blank the API would have to ignore.
    expect(paramsOfCall(0)).toEqual({
      sort: TICKET_SORT_FIELD.subject,
      order: SORT_ORDER.asc,
      page: 3,
      pageSize: 50,
      status: TICKET_STATUS.Open,
      category: TICKET_CATEGORY.Refund,
      q: "login",
    });
  });

  test("falls back to the defaults a malformed URL implies", async () => {
    ticketsGet.mockResolvedValue(ticketsResponse("Cannot log in"));

    await runLoader(
      ticketsLoader,
      "/tickets?sort=nonsense&order=sideways&status=Bogus&page=one",
    );

    expect(paramsOfCall(0)).toEqual({
      sort: DEFAULT_TICKET_SORT.field,
      order: DEFAULT_TICKET_SORT.order,
      page: FIRST_PAGE,
      pageSize: DEFAULT_PAGE_SIZE,
    });
  });

  test("primes the entry the page then reads, from a malformed URL", async () => {
    // The loader's request answers; the page's own refetch never settles. So
    // the rows below can only be the ones the loader primed — a page reading a
    // neighbouring key would have nothing but its own pending query, and would
    // render the skeleton instead.
    ticketsGet.mockResolvedValueOnce(ticketsResponse("Primed by the loader"));
    ticketsGet.mockReturnValue(new Promise(() => {}));

    renderRoutes(
      [{ path: "/tickets", loader: ticketsLoader, Component: TicketsPage }],
      {
        initialEntries: ["/tickets?sort=nonsense&status=Bogus"],
        // The suite's default client sets `gcTime: 0`, which collects an entry
        // the moment it settles with no observer — and between a loader
        // settling and its page mounting there is nobody observing anything.
        // The app's own client keeps entries for five minutes, so this is the
        // faithful half of that trade, not a workaround for the loader.
        queryClient: new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: Infinity } },
        }),
      },
    );

    expect(
      await screen.findByRole("link", { name: "Primed by the loader" }),
    ).toBeInTheDocument();

    // Same defaults on both sides, which is what reading the URL through
    // `parseTicketListParams` at both call sites buys — the page's own refetch
    // asks for exactly what the loader already fetched.
    const defaults = {
      sort: DEFAULT_TICKET_SORT.field,
      order: DEFAULT_TICKET_SORT.order,
      page: FIRST_PAGE,
      pageSize: DEFAULT_PAGE_SIZE,
    };
    for (let call = 0; call < ticketsGet.mock.calls.length; call += 1) {
      expect(paramsOfCall(call)).toEqual(defaults);
    }
  });
});
