import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TICKET_STATUS } from "@ticket/shared";
import { apiStub } from "@/test/api-stub";
import { renderRoutes } from "@/test/render";
import { LIST_PARAM } from "@/lib/list-param";
import { ROUTE } from "@/lib/routes";
import {
  WELCOME_LABEL,
  WELCOME_OWNER,
  WELCOME_REPOSITORY,
  WELCOME_STACK,
} from "@/lib/welcome";
import { WELCOME_STEPS } from "@/lib/welcome-steps";
import { WelcomePage } from "./WelcomePage";

vi.mock("@/lib/api", () => import("@/test/api-stub"));

// Taken over from the stub's default so a request for any page's Tutorial
// would be counted (R9).
const tutorialGet = apiStub.get("/api/tutorials/:pageKey");
const stepPost = apiStub.post("/api/demo/welcome-step");

function renderWelcome() {
  return renderRoutes(
    [
      { path: ROUTE.welcome.path, element: <WelcomePage /> },
      { path: ROUTE.dashboard.path, element: <p>dashboard</p> },
      { path: ROUTE.howItWorks.path, element: <p>how it works</p> },
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
    const steps = within(
      screen.getByRole("region", { name: WELCOME_LABEL.howHeading }),
    )
      .getAllByRole("listitem")
      .map((li) => li.textContent);

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

describe("WelcomePage's owner and stack", () => {
  // R3: name, role, a short bio, and LinkedIn, GitHub and email.
  test("introduces the owner, with a bio and three ways to reach them", () => {
    renderWelcome();
    const owner = screen.getByRole("region", {
      name: WELCOME_LABEL.ownerHeading,
    });

    expect(owner).toHaveTextContent(WELCOME_OWNER.name);
    expect(owner).toHaveTextContent(WELCOME_OWNER.role);
    expect(WELCOME_OWNER.bio.length).toBeGreaterThan(0);
    for (const paragraph of WELCOME_OWNER.bio) {
      expect(within(owner).getByText(paragraph)).toBeInTheDocument();
    }
    const links = within(owner).getAllByRole("link");
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual(
      WELCOME_OWNER.links.map((l) => [l.name, l.href]),
    );
  });

  // R5: one line naming the stack, and the public repository.
  test("names the stack in one line and links to the source", () => {
    renderWelcome();
    const stack = screen.getByRole("region", {
      name: WELCOME_LABEL.stackHeading,
    });

    expect(WELCOME_STACK.match(/[.!?](\s|$)/g)).toHaveLength(1);
    expect(WELCOME_STACK).toMatch(/React/);
    expect(WELCOME_STACK).toMatch(/Postgres/);
    expect(within(stack).getByText(WELCOME_STACK)).toBeInTheDocument();
    expect(
      within(stack).getByRole("link", { name: WELCOME_REPOSITORY.name }),
    ).toHaveAttribute(
      "href",
      "https://github.com/AlexHun/ticket-manager-system",
    );
  });

  // The PRD's decision: no phone number and no address on the page.
  test("shows no phone number and no address", () => {
    const { container } = renderWelcome();
    const text = container.textContent ?? "";

    expect(text).not.toMatch(/\+?\d[\d\s()-]{7,}\d/);
    expect(text).not.toMatch(/Palanga|Lithuania|street|tel:/i);
    expect(container.querySelector('a[href^="tel:"]')).toBeNull();
  });

  // R12's reading order: the page's heading, then the sections in the order a
  // screen reader reads them, each under a heading, Start exploring last.
  test("reads its sections in order, Start exploring last", () => {
    renderWelcome();

    expect(
      screen.getAllByRole("heading").map((h) => [h.tagName, h.textContent]),
    ).toEqual([
      ["H1", WELCOME_LABEL.title],
      ["H2", WELCOME_LABEL.howHeading],
      ["H2", WELCOME_LABEL.stepsHeading],
      ["H2", WELCOME_LABEL.ownerHeading],
      ["H2", WELCOME_LABEL.stackHeading],
    ]);
    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual([
      ...WELCOME_STEPS.map((s) => s.sentence),
      ...WELCOME_OWNER.links.map((l) => l.name),
      WELCOME_REPOSITORY.name,
      WELCOME_LABEL.startExploring,
    ]);
  });
});

describe("WelcomePage's suggested steps", () => {
  function stepLinks() {
    return within(
      screen.getByRole("region", { name: WELCOME_LABEL.stepsHeading }),
    ).getAllByRole("link");
  }

  // R4: 3 to 5 steps, each one sentence linking to a screen, none to a
  // ticket by id (the nightly reset re-creates those with new ids).
  test("offers every step in the list, each a one-sentence link", () => {
    renderWelcome();
    const links = stepLinks();

    expect(WELCOME_STEPS.length).toBeGreaterThanOrEqual(3);
    expect(WELCOME_STEPS.length).toBeLessThanOrEqual(5);
    expect(links.map((a) => a.textContent)).toEqual(
      WELCOME_STEPS.map((s) => s.sentence),
    );
    expect(links.map((a) => a.getAttribute("href"))).toEqual(
      WELCOME_STEPS.map((s) => s.to),
    );
    for (const step of WELCOME_STEPS) {
      expect(step.sentence.match(/[.!?](\s|$)/g)).toHaveLength(1);
      expect(step.to).not.toMatch(/^\/tickets\/\d/);
    }
  });

  // R13, and #466's criteria: How it works is the first step, read from the
  // route record, and its sentence says what the page shows.
  test("leads with How it works", () => {
    renderWelcome();
    const [first] = WELCOME_STEPS;

    expect(first?.to).toBe(ROUTE.howItWorks.path);
    expect(first?.sentence).toMatch(/how the system fits together/);
    expect(stepLinks()[0]).toHaveAttribute("href", ROUTE.howItWorks.path);
  });

  test("the resolved-tickets step opens the list filtered to Resolved", () => {
    const step = WELCOME_STEPS.find((s) => s.key === "resolved-tickets");
    const url = new URL(step!.to, "http://welcome.test");

    expect(url.pathname).toBe(ROUTE.tickets.path);
    expect(url.searchParams.get(LIST_PARAM.status)).toBe(
      TICKET_STATUS.Resolved,
    );
  });

  test("following a step records it and goes there", async () => {
    stepPost.mockResolvedValue({ data: undefined });
    const { router } = renderWelcome();

    await userEvent.click(stepLinks()[0]!);

    expect(await screen.findByText("how it works")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(ROUTE.howItWorks.path);
    expect(stepPost).toHaveBeenCalledTimes(1);
  });

  // The visitor's navigation never waits on the tally: a write that never
  // answers still lets the click land.
  test("navigation does not wait for the record to be saved", async () => {
    stepPost.mockReturnValue(new Promise(() => {}));
    const { router } = renderWelcome();

    await userEvent.click(stepLinks()[0]!);

    expect(await screen.findByText("how it works")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(ROUTE.howItWorks.path);
  });

  // A middle click opens the step in a new tab: `auxclick`, not `click`. A
  // right click is not a follow.
  test("a middle click records the step, a right click does not", async () => {
    stepPost.mockResolvedValue({ data: undefined });
    renderWelcome();
    const [link] = stepLinks();

    fireEvent(link!, new MouseEvent("auxclick", { bubbles: true, button: 2 }));
    fireEvent(link!, new MouseEvent("auxclick", { bubbles: true, button: 1 }));

    await waitFor(() => expect(stepPost).toHaveBeenCalled());
    expect(stepPost).toHaveBeenCalledTimes(1);
  });

  test("Start exploring records nothing", async () => {
    renderWelcome();

    await userEvent.click(
      screen.getByRole("link", { name: WELCOME_LABEL.startExploring }),
    );

    expect(await screen.findByText("dashboard")).toBeInTheDocument();
    expect(stepPost).not.toHaveBeenCalled();
  });
});
