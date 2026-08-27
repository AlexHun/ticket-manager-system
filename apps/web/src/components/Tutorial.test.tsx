import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { TUTORIAL_PAGE_KEY, type TutorialStatus } from "@ticket/shared";
import { renderWithQuery } from "@/test/render";
import { Tutorial } from "./Tutorial";

// --- Mocks ----------------------------------------------------------------

const mockGet = vi.fn();
const mockPost = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

// --- Fixtures ---------------------------------------------------------------

const unwritten: TutorialStatus = {
  content: {
    pageKey: TUTORIAL_PAGE_KEY.dashboard,
    title: "",
    steps: [],
    updatedAt: null,
    updatedByName: null,
  },
  shouldShow: false,
};

const alreadySeen: TutorialStatus = {
  content: {
    pageKey: TUTORIAL_PAGE_KEY.dashboard,
    title: "Reading the dashboard",
    steps: [{ title: "The stat row", body: "Four numbers, one glance." }],
    updatedAt: "2026-08-01T12:00:00.000Z",
    updatedByName: "Ada Admin",
  },
  shouldShow: false,
};

const dueToShow: TutorialStatus = {
  content: {
    pageKey: TUTORIAL_PAGE_KEY.dashboard,
    title: "Reading the dashboard",
    steps: [
      { title: "The stat row", body: "Four numbers, one glance." },
      { title: "The chart", body: "Volume over time." },
    ],
    updatedAt: "2026-08-01T12:00:00.000Z",
    updatedByName: "Ada Admin",
  },
  shouldShow: true,
};

function renderTutorial() {
  return renderWithQuery(<Tutorial pageKey={TUTORIAL_PAGE_KEY.dashboard} />);
}

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockPost.mockResolvedValue({ data: { ok: true } });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Tutorial", () => {
  test("renders nothing for a page with no written content", async () => {
    mockGet.mockResolvedValue({ data: { tutorial: unwritten } });
    renderTutorial();

    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("stays closed when the user has already seen the current version", async () => {
    mockGet.mockResolvedValue({ data: { tutorial: alreadySeen } });
    renderTutorial();

    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  test("requests the page's own status with a cancellation signal", async () => {
    mockGet.mockResolvedValue({ data: { tutorial: dueToShow } });
    renderTutorial();

    await screen.findByRole("dialog");

    const [url, options] = mockGet.mock.calls[0] as [string, { signal: AbortSignal }];
    expect(url).toBe(`/api/tutorials/${TUTORIAL_PAGE_KEY.dashboard}`);
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  test("opens unprompted on the first step when shouldShow is true", async () => {
    mockGet.mockResolvedValue({ data: { tutorial: dueToShow } });
    renderTutorial();

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Reading the dashboard");
    expect(dialog).toHaveTextContent("Step 1 of 2");
    expect(dialog).toHaveTextContent("The stat row");
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  });

  test("Next advances the step and reveals Back; Got it finishes on the last step", async () => {
    mockGet.mockResolvedValue({ data: { tutorial: dueToShow } });
    const user = userEvent.setup();
    renderTutorial();

    const dialog = await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(dialog).toHaveTextContent("Step 2 of 2");
    expect(dialog).toHaveTextContent("The chart");
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Got it" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith(
      `/api/tutorials/${TUTORIAL_PAGE_KEY.dashboard}/seen`,
    );
  });

  test("Back returns to the previous step", async () => {
    mockGet.mockResolvedValue({ data: { tutorial: dueToShow } });
    const user = userEvent.setup();
    renderTutorial();

    const dialog = await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(dialog).toHaveTextContent("Step 1 of 2");
    expect(dialog).toHaveTextContent("The stat row");
  });

  test("dismissing via the close button also marks the tutorial seen", async () => {
    mockGet.mockResolvedValue({ data: { tutorial: dueToShow } });
    const user = userEvent.setup();
    renderTutorial();

    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(mockPost).toHaveBeenCalledWith(
      `/api/tutorials/${TUTORIAL_PAGE_KEY.dashboard}/seen`,
    );
  });
});

// --- Anchored callouts -------------------------------------------------------

const anchoredDueToShow: TutorialStatus = {
  content: {
    pageKey: TUTORIAL_PAGE_KEY.dashboard,
    title: "Reading the dashboard",
    steps: [
      {
        title: "The stat row",
        body: "Four numbers, one glance.",
        anchor: "kpis",
      },
      {
        title: "The chart",
        body: "Volume over time.",
        anchor: "range",
      },
    ],
    updatedAt: "2026-08-01T12:00:00.000Z",
    updatedByName: "Ada Admin",
  },
  shouldShow: true,
};

describe("Tutorial — anchored callout", () => {
  test("positions a callout against the tagged element instead of a centered dialog", async () => {
    mockGet.mockResolvedValue({ data: { tutorial: anchoredDueToShow } });
    renderWithQuery(
      <>
        <div data-tutorial-anchor="kpis">KPI row</div>
        <Tutorial pageKey={TUTORIAL_PAGE_KEY.dashboard} />
      </>,
    );

    const callout = await screen.findByRole("dialog", {
      name: "Reading the dashboard",
    });
    expect(callout).toHaveTextContent("The stat row");
    expect(callout.parentElement?.querySelector("svg line")).toBeInTheDocument();
    expect(
      callout.parentElement?.querySelector(".animate-ping"),
    ).toBeInTheDocument();
    expect(callout).toHaveTextContent("Step 1 of 2");
  });

  test("Next re-resolves the callout against the following step's own anchor", async () => {
    mockGet.mockResolvedValue({ data: { tutorial: anchoredDueToShow } });
    const user = userEvent.setup();
    renderWithQuery(
      <>
        <div data-tutorial-anchor="kpis">KPI row</div>
        <div data-tutorial-anchor="range">Range controls</div>
        <Tutorial pageKey={TUTORIAL_PAGE_KEY.dashboard} />
      </>,
    );

    const first = await screen.findByRole("dialog");
    expect(first).toHaveTextContent("The stat row");
    await user.click(within(first).getByRole("button", { name: "Next" }));

    const second = await screen.findByRole("dialog");
    expect(second).toHaveTextContent("The chart");
  });

  test("the callout's close button marks the tutorial seen", async () => {
    mockGet.mockResolvedValue({ data: { tutorial: anchoredDueToShow } });
    const user = userEvent.setup();
    renderWithQuery(
      <>
        <div data-tutorial-anchor="kpis">KPI row</div>
        <Tutorial pageKey={TUTORIAL_PAGE_KEY.dashboard} />
      </>,
    );

    const callout = await screen.findByRole("dialog");
    await user.click(within(callout).getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(mockPost).toHaveBeenCalledWith(
      `/api/tutorials/${TUTORIAL_PAGE_KEY.dashboard}/seen`,
    );
  });

  test("Escape closes the callout and marks the tutorial seen", async () => {
    mockGet.mockResolvedValue({ data: { tutorial: anchoredDueToShow } });
    const user = userEvent.setup();
    renderWithQuery(
      <>
        <div data-tutorial-anchor="kpis">KPI row</div>
        <Tutorial pageKey={TUTORIAL_PAGE_KEY.dashboard} />
      </>,
    );

    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(mockPost).toHaveBeenCalledWith(
      `/api/tutorials/${TUTORIAL_PAGE_KEY.dashboard}/seen`,
    );
  });

  test("resolves through a display:contents anchor wrapper to measure its real child", async () => {
    // Several pages tag the anchor on a `display: contents` wrapper so the
    // attribute can sit beside a grid/flex item without becoming the item
    // itself — see e.g. TicketsPage.tsx. `display: contents` generates no
    // box, so `getBoundingClientRect()` on the wrapper itself would be
    // degenerate; this pins down that positioning measures the real child
    // underneath instead.
    mockGet.mockResolvedValue({ data: { tutorial: anchoredDueToShow } });
    const rectSpy = vi.spyOn(Element.prototype, "getBoundingClientRect");

    const { container } = renderWithQuery(
      <>
        <div data-tutorial-anchor="kpis" style={{ display: "contents" }}>
          <button type="button">Actual target</button>
        </div>
        <Tutorial pageKey={TUTORIAL_PAGE_KEY.dashboard} />
      </>,
    );

    await screen.findByRole("dialog");

    const wrapper = container.querySelector('[data-tutorial-anchor="kpis"]')!;
    const button = screen.getByRole("button", { name: "Actual target" });

    expect(rectSpy.mock.instances).not.toContain(wrapper);
    expect(rectSpy.mock.instances).toContain(button);

    rectSpy.mockRestore();
  });

  test("scrolls the target into view when it resolves off-screen", async () => {
    mockGet.mockResolvedValue({ data: { tutorial: anchoredDueToShow } });
    const rectSpy = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockReturnValue({
        top: -50,
        left: 0,
        bottom: 20,
        right: 100,
        width: 100,
        height: 70,
        x: 0,
        y: -50,
        toJSON() {},
      } as DOMRect);
    const scrollSpy = vi.spyOn(Element.prototype, "scrollIntoView");

    renderWithQuery(
      <>
        <div data-tutorial-anchor="kpis">KPI row</div>
        <Tutorial pageKey={TUTORIAL_PAGE_KEY.dashboard} />
      </>,
    );

    await screen.findByRole("dialog");

    expect(scrollSpy).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });

    rectSpy.mockRestore();
    scrollSpy.mockRestore();
  });

  test("does not scroll when the target is already fully visible", async () => {
    mockGet.mockResolvedValue({ data: { tutorial: anchoredDueToShow } });
    const scrollSpy = vi.spyOn(Element.prototype, "scrollIntoView");

    renderWithQuery(
      <>
        <div data-tutorial-anchor="kpis">KPI row</div>
        <Tutorial pageKey={TUTORIAL_PAGE_KEY.dashboard} />
      </>,
    );

    await screen.findByRole("dialog");

    expect(scrollSpy).not.toHaveBeenCalled();
    scrollSpy.mockRestore();
  });

  test("falls back to the centered dialog when the tagged element never appears", async () => {
    mockGet.mockResolvedValue({ data: { tutorial: anchoredDueToShow } });
    renderWithQuery(<Tutorial pageKey={TUTORIAL_PAGE_KEY.dashboard} />);

    const dialog = await screen.findByRole("dialog", undefined, {
      timeout: 6000,
    });
    expect(dialog).toHaveTextContent("Step 1 of 2");
  }, 8000);
});
