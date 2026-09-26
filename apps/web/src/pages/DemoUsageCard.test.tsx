import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { DemoUsageResponse } from "@ticket/shared";
import { apiStub } from "@/test/api-stub";
import { renderRoutes } from "@/test/render";
import { DemoUsageCard } from "./DemoUsageCard";

vi.mock("@/lib/api", () => import("@/test/api-stub"));

const statusGet = apiStub.get("/api/demo");
const usageGet = apiStub.get("/api/demo/usage");

const THIS_WEEK: DemoUsageResponse = {
  weekStartsAt: "2026-09-21T00:00:00.000Z",
  started: 12,
  openedTicket: 5,
};

beforeEach(() => {
  apiStub.reset();
});

const renderCard = () =>
  renderRoutes([{ path: "/", element: <DemoUsageCard /> }]);

describe("DemoUsageCard", () => {
  test("shows the week's demo sessions and how many opened a ticket", async () => {
    statusGet.mockResolvedValue({ data: { enabled: true } });
    usageGet.mockResolvedValue({ data: THIS_WEEK });

    renderCard();

    const card = await screen.findByRole("region", {
      name: "Demo sessions this week",
    });
    expect(card).toHaveTextContent("Started12");
    expect(card).toHaveTextContent("Opened a ticket5");
  });

  // A deployment that takes real mail never offered a demo, and a card of
  // zeroes about it would be noise on the page.
  test("renders nothing and asks nothing while demo mode is off", async () => {
    statusGet.mockResolvedValue({ data: { enabled: false } });

    const { container } = renderCard();

    await waitFor(() => expect(statusGet).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    expect(usageGet).not.toHaveBeenCalled();
  });
});
