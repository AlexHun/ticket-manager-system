import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import type { TicketUnreadResponse } from "@ticket/shared";
import { toast } from "@/components/ui/sonner";
import { apiStub } from "@/test/api-stub";
import { renderRoutes } from "@/test/render";
import { ticketKeys } from "@/lib/ticket-queries";
import { useAssignmentToasts } from "./use-assignment-toasts";

// --- Mocks ------------------------------------------------------------------

vi.mock("@/lib/api", () => import("@/test/api-stub"));

/** The one endpoint the hook reads. */
const unreadGet = apiStub.get("/api/tickets/unread");

function unread(tickets: TicketUnreadResponse["tickets"]) {
  return { data: { tickets } satisfies TicketUnreadResponse };
}

/** The hook renders nothing; this is just something to mount it under. */
function Host() {
  useAssignmentToasts();
  return null;
}

function renderHost() {
  return renderRoutes([
    { path: "/", element: <Host /> },
    { path: "/tickets/:id", element: <div>ticket detail page</div> },
  ]);
}

/**
 * The query having *started* (`unreadGet` called) is not the query having
 * *landed* — `queryFn` calls `api.get` synchronously before awaiting it, so a
 * `waitFor` keyed on the mock alone can resolve before react-query has
 * applied the result and re-rendered. Wait for the settled state instead.
 */
function waitForSettled(queryClient: QueryClient) {
  return waitFor(() =>
    expect(queryClient.getQueryState(ticketKeys.unread)?.status).toBe(
      "success",
    ),
  );
}

beforeEach(() => {
  apiStub.reset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useAssignmentToasts", () => {
  test("the first read establishes a baseline and toasts nothing", async () => {
    unreadGet.mockResolvedValueOnce(
      unread([{ id: 1, subject: "Already unread before this tab opened" }]),
    );

    const { queryClient } = renderHost();
    await waitForSettled(queryClient);

    expect(toast.message).not.toHaveBeenCalled();
  });

  test("a ticket that joins the set after the baseline is toasted", async () => {
    unreadGet.mockResolvedValueOnce(unread([]));
    const { queryClient } = renderHost();
    await waitForSettled(queryClient);

    unreadGet.mockResolvedValueOnce(
      unread([{ id: 7, subject: "Cannot log in" }]),
    );
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ticketKeys.unread });
    });

    await waitFor(() => expect(toast.message).toHaveBeenCalledTimes(1));
    expect(toast.message).toHaveBeenCalledWith(
      "Assigned to you: Cannot log in",
      expect.objectContaining({
        action: expect.objectContaining({ label: "Open" }),
      }),
    );
  });

  test("a ticket already in the baseline is not re-toasted on a later refetch", async () => {
    unreadGet.mockResolvedValueOnce(unread([{ id: 1, subject: "Old news" }]));
    const { queryClient } = renderHost();
    await waitForSettled(queryClient);

    // Same set again — nothing new, nothing to say.
    unreadGet.mockResolvedValueOnce(unread([{ id: 1, subject: "Old news" }]));
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ticketKeys.unread });
    });
    await waitFor(() => expect(unreadGet).toHaveBeenCalledTimes(2));

    expect(toast.message).not.toHaveBeenCalled();
  });

  test("clicking the toast's action opens the ticket", async () => {
    unreadGet.mockResolvedValueOnce(unread([]));
    const { queryClient } = renderHost();
    await waitForSettled(queryClient);

    unreadGet.mockResolvedValueOnce(
      unread([{ id: 7, subject: "Cannot log in" }]),
    );
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ticketKeys.unread });
    });

    await waitFor(() => expect(toast.message).toHaveBeenCalledTimes(1));
    const [, options] = vi.mocked(toast.message).mock.calls[0];
    const action = options?.action as { onClick: () => void } | undefined;
    const onClick = action?.onClick;
    if (!onClick) throw new Error("toast was not given an action");

    // A data router navigation settles in a microtask — it is allowed to run
    // loaders — so the click needs an *async* act to flush the state update
    // React then renders from. Under the memory router this file mounted
    // before #159 the update was synchronous and a bare `act()` saw it.
    await act(async () => {
      onClick();
    });

    expect(await screen.findByText("ticket detail page")).toBeInTheDocument();
  });
});
