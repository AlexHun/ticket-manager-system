import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { apiStub } from "@/test/api-stub";
import { renderRoutes } from "@/test/render";
import { ROUTE } from "@/lib/routes";
import { WELCOME_LABEL } from "@/lib/welcome";
import { WelcomePage } from "./WelcomePage";

vi.mock("@/lib/api", () => import("@/test/api-stub"));

// Taken over from the stub's default so a request for any page's Tutorial
// would be counted (R9).
const tutorialGet = apiStub.get("/api/tutorials/:pageKey");

function renderWelcome() {
  return renderRoutes(
    [
      { path: ROUTE.welcome.path, element: <WelcomePage /> },
      { path: ROUTE.dashboard.path, element: <p>dashboard</p> },
    ],
    { initialEntries: [ROUTE.welcome.path] },
  );
}

beforeEach(() => {
  apiStub.reset();
});

describe("WelcomePage", () => {
  test("is headed as the welcome", () => {
    renderWelcome();
    expect(
      screen.getByRole("heading", { level: 1, name: WELCOME_LABEL.title }),
    ).toBeInTheDocument();
  });

  // R2, in CONTEXT.md's words: email arrives, the assistant classifies it,
  // then an auto-reply from the knowledge base or a handoff to an agent.
  test("says what the product does, in the desk's own terms", () => {
    renderWelcome();
    const steps = screen.getAllByRole("listitem").map((li) => li.textContent);

    expect(steps).toHaveLength(3);
    expect(steps[0]).toMatch(/emails/);
    expect(steps[0]).toMatch(/ticket/);
    expect(steps[1]).toMatch(/assistant classifies/);
    expect(steps[2]).toMatch(/auto-reply/);
    expect(steps[2]).toMatch(/knowledge articles?/);
    expect(steps[2]).toMatch(/hands the ticket off to an agent/);
  });

  test("Start exploring leaves for the Dashboard", async () => {
    const { router } = renderWelcome();

    await userEvent.click(
      screen.getByRole("link", { name: WELCOME_LABEL.startExploring }),
    );

    expect(await screen.findByText("dashboard")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(ROUTE.dashboard.path);
  });

  // R9: no page Tutorial pops up over the welcome.
  test("asks for no Tutorial", () => {
    renderWelcome();
    expect(tutorialGet).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
