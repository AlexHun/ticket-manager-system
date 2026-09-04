import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";
import {
  Link,
  Outlet,
  useLoaderData,
  useNavigation,
  useParams,
} from "react-router-dom";
import { renderRoutes } from "./render";

/**
 * What `renderRoutes` buys over the `MemoryRouter` in `renderWithQuery`: the
 * three data-router features the app's own `createBrowserRouter` provides and
 * the component router does not. Each of them is something the prefetch work
 * added and nothing below E2E could reach until #148.
 */

function TicketDetail() {
  return <p>Ticket {useParams().id}</p>;
}

describe("renderRoutes", () => {
  test("matches the route the entry URL points at", () => {
    renderRoutes(
      [
        { path: "/tickets", Component: () => <p>List</p> },
        { path: "/tickets/:id", Component: TicketDetail },
      ],
      { initialEntries: ["/tickets/7"] },
    );

    expect(screen.getByText("Ticket 7")).toBeInTheDocument();
    expect(screen.queryByText("List")).not.toBeInTheDocument();
  });

  test("runs a route's loader before its component renders", async () => {
    function Loaded() {
      return <p>{useLoaderData() as string}</p>;
    }

    renderRoutes([
      {
        path: "/",
        HydrateFallback: () => <p>Hydrating</p>,
        loader: () => Promise.resolve("loaded"),
        Component: Loaded,
      },
    ]);

    // Synchronously after render the loader has not settled, so the component
    // has not mounted — the gap a route's own `HydrateFallback` covers.
    expect(screen.getByText("Hydrating")).toBeInTheDocument();
    expect(await screen.findByText("loaded")).toBeInTheDocument();
  });

  test("reports the pending navigation while the next route's loader runs", async () => {
    let arrive: (() => void) | undefined;
    const slowLoader = () =>
      new Promise<null>((resolve) => {
        arrive = () => resolve(null);
      });

    function Shell() {
      return (
        <>
          <output data-testid="nav-state">{useNavigation().state}</output>
          <Outlet />
        </>
      );
    }

    const { router } = renderRoutes([
      {
        path: "/",
        Component: Shell,
        children: [
          { index: true, Component: () => <Link to="/next">Go</Link> },
          { path: "next", loader: slowLoader, Component: () => <p>Next</p> },
        ],
      },
    ]);

    const user = userEvent.setup();
    expect(screen.getByTestId("nav-state")).toHaveTextContent("idle");

    await user.click(screen.getByRole("link", { name: "Go" }));

    // This is the subject a shared pending indicator would render from, and
    // the reason `TicketsPage.loader.ts` could not have one covered by a test.
    await waitFor(() =>
      expect(screen.getByTestId("nav-state")).toHaveTextContent("loading"),
    );
    expect(screen.queryByText("Next")).not.toBeInTheDocument();

    arrive?.();

    expect(await screen.findByText("Next")).toBeInTheDocument();
    expect(screen.getByTestId("nav-state")).toHaveTextContent("idle");
    // The live router, so a URL assertion needs no probe component.
    await waitFor(() => expect(router.state.location.pathname).toBe("/next"));
  });
});
