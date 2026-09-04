import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { TUTORIAL_PAGE_KEY, type TutorialContent } from "@ticket/shared";
import { apiStub } from "@/test/api-stub";
import { renderRoutes } from "@/test/render";
import { TutorialsPage } from "./TutorialsPage";

// --- Mocks ----------------------------------------------------------------

vi.mock("@/lib/api", () => import("@/test/api-stub"));

// The admin roster of tutorials, and the save behind the editor dialog. This
// is the one page in the app that does *not* mount a `<Tutorial>` of its own,
// so `/api/tutorials/:pageKey` here is only ever the PUT.
const tutorialsGet = apiStub.get("/api/tutorials");
const tutorialPut = apiStub.put("/api/tutorials/:pageKey");

// --- Fixtures ---------------------------------------------------------------

const unwritten: TutorialContent = {
  pageKey: TUTORIAL_PAGE_KEY.outbox,
  title: "",
  steps: [],
  updatedAt: null,
  updatedByName: null,
};

const written: TutorialContent = {
  pageKey: TUTORIAL_PAGE_KEY.dashboard,
  title: "Reading the dashboard",
  steps: [
    { title: "The stat row", body: "Four numbers, one glance." },
    { title: "The chart", body: "Volume over time." },
  ],
  updatedAt: "2026-08-01T12:00:00.000Z",
  updatedByName: "Ada Admin",
};

/** On the real router, at the page's own path — as a navigation would match it. */
function renderTutorialsPage() {
  return renderRoutes([{ path: "/tutorials", Component: TutorialsPage }], {
    initialEntries: ["/tutorials"],
  });
}

async function openEditDialog(name: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name }));
  return user;
}

// --- Tests ------------------------------------------------------------------

beforeEach(() => {
  apiStub.reset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("TutorialsPage", () => {
  test("renders the loading skeleton while the request is pending", () => {
    tutorialsGet.mockReturnValue(new Promise(() => {}));
    renderTutorialsPage();

    expect(screen.getByLabelText("Loading tutorials")).toBeInTheDocument();
    expect(screen.getByLabelText("Loading tutorials")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  test("renders a row per tutorial once the query resolves", async () => {
    tutorialsGet.mockResolvedValue({ data: { tutorials: [written, unwritten] } });
    renderTutorialsPage();

    expect(await screen.findByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Outbox")).toBeInTheDocument();
    expect(screen.queryByLabelText("Loading tutorials")).not.toBeInTheDocument();
  });

  test("shows the title and step count for a written tutorial", async () => {
    tutorialsGet.mockResolvedValue({ data: { tutorials: [written] } });
    renderTutorialsPage();

    expect(await screen.findByText("Reading the dashboard")).toBeInTheDocument();
    expect(screen.getByText("2 steps")).toBeInTheDocument();
    expect(screen.getByText(/Updated .* by Ada Admin/)).toBeInTheDocument();
  });

  test("shows 'Not written yet' for a page with no content", async () => {
    tutorialsGet.mockResolvedValue({ data: { tutorials: [unwritten] } });
    renderTutorialsPage();

    expect(await screen.findByText("Not written yet")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Nothing is shown to users on this page until it is written.",
      ),
    ).toBeInTheDocument();
  });

  test("calls GET /api/tutorials with a cancellation signal", async () => {
    tutorialsGet.mockResolvedValue({ data: { tutorials: [written] } });
    renderTutorialsPage();

    await screen.findByText("Dashboard");

    expect(tutorialsGet).toHaveBeenCalledTimes(1);
    const [url, options] = tutorialsGet.mock.calls[0] as [string, { signal: AbortSignal }];
    expect(url).toBe("/api/tutorials");
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  test("renders an alert when the request fails", async () => {
    tutorialsGet.mockRejectedValue(new Error("boom"));
    renderTutorialsPage();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("boom");
  });
});

describe("TutorialsPage — editing", () => {
  test("opens the editor pre-filled with the page's existing content", async () => {
    tutorialsGet.mockResolvedValue({ data: { tutorials: [written] } });
    renderTutorialsPage();
    await screen.findByText("Dashboard");

    await openEditDialog("Edit");

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Dashboard" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Title")).toHaveValue(
      "Reading the dashboard",
    );
    expect(within(dialog).getByLabelText("Step 1 title")).toHaveValue(
      "The stat row",
    );
    expect(within(dialog).getByLabelText("Step 2 title")).toHaveValue(
      "The chart",
    );
  });

  test("opens the editor with one blank step for an unwritten page", async () => {
    tutorialsGet.mockResolvedValue({ data: { tutorials: [unwritten] } });
    renderTutorialsPage();
    await screen.findByText("Outbox");

    await openEditDialog("Edit");

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByText(/^Step \d$/)).toHaveLength(1);
    expect(within(dialog).getByLabelText("Title")).toHaveValue("");
  });

  test("Add step appends a blank step, up to the max", async () => {
    tutorialsGet.mockResolvedValue({ data: { tutorials: [unwritten] } });
    renderTutorialsPage();
    await screen.findByText("Outbox");

    const user = await openEditDialog("Edit");
    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getByRole("button", { name: "Add step" }));

    expect(within(dialog).getAllByText(/^Step \d$/)).toHaveLength(2);
  });

  test("Remove is disabled with only one step, and removes otherwise", async () => {
    tutorialsGet.mockResolvedValue({ data: { tutorials: [written] } });
    renderTutorialsPage();
    await screen.findByText("Dashboard");

    const user = await openEditDialog("Edit");
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getAllByText(/^Step \d$/)).toHaveLength(2);
    const removeButtons = within(dialog).getAllByRole("button", {
      name: "Remove",
    });
    await user.click(removeButtons[0]!);

    expect(within(dialog).getAllByText(/^Step \d$/)).toHaveLength(1);
    expect(
      within(dialog).getByRole("button", { name: "Remove" }),
    ).toBeDisabled();
  });

  test("shows a validation error when the title is empty", async () => {
    tutorialsGet.mockResolvedValue({ data: { tutorials: [unwritten] } });
    renderTutorialsPage();
    await screen.findByText("Outbox");

    const user = await openEditDialog("Edit");
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByLabelText("Step 1 title"), "First");
    await user.type(within(dialog).getByLabelText("Step 1 body"), "Do this.");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    expect(
      await within(dialog).findByText("Give the tutorial a title"),
    ).toBeInTheDocument();
    expect(tutorialPut).not.toHaveBeenCalled();
  });

  test("submits PUT /api/tutorials/:pageKey, closes the dialog, and refetches on success", async () => {
    tutorialsGet
      .mockResolvedValueOnce({ data: { tutorials: [unwritten] } })
      .mockResolvedValueOnce({ data: { tutorials: [written] } });
    tutorialPut.mockResolvedValue({ data: { tutorial: written } });

    renderTutorialsPage();
    await screen.findByText("Outbox");

    const user = await openEditDialog("Edit");
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByLabelText("Title"), "Sending mail");
    await user.type(within(dialog).getByLabelText("Step 1 title"), "Queue");
    await user.type(
      within(dialog).getByLabelText("Step 1 body"),
      "Every outbound message waits here first.",
    );
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(tutorialPut).toHaveBeenCalledTimes(1);
    });
    const [url, body] = tutorialPut.mock.calls[0] as [
      string,
      { title: string; steps: { title: string; body: string }[] },
    ];
    expect(url).toBe(`/api/tutorials/${TUTORIAL_PAGE_KEY.outbox}`);
    expect(body).toEqual({
      title: "Sending mail",
      steps: [
        { title: "Queue", body: "Every outbound message waits here first." },
      ],
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(tutorialsGet).toHaveBeenCalledTimes(2);
  });

  test("keeps the dialog open and shows the server error when the save fails", async () => {
    tutorialsGet.mockResolvedValue({ data: { tutorials: [written] } });
    const axiosError = Object.assign(new Error("Request failed"), {
      isAxiosError: true,
      response: { status: 400, data: { error: "Give the tutorial a title" } },
    });
    tutorialPut.mockRejectedValue(axiosError);

    renderTutorialsPage();
    await screen.findByText("Dashboard");

    const user = await openEditDialog("Edit");
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    expect(
      await within(dialog).findByText("Give the tutorial a title"),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(tutorialsGet).toHaveBeenCalledTimes(1);
  });
});

describe("TutorialsPage — step anchors", () => {
  test("a step's anchor picker defaults to centered, with that page's own options", async () => {
    tutorialsGet.mockResolvedValue({ data: { tutorials: [unwritten] } });
    renderTutorialsPage();
    await screen.findByText("Outbox");

    const user = await openEditDialog("Edit");
    const dialog = await screen.findByRole("dialog");

    const trigger = within(dialog).getByRole("combobox", {
      name: "Step 1 points at",
    });
    expect(trigger).toHaveTextContent("No target (centered)");

    await user.click(trigger);
    expect(
      await screen.findByRole("option", { name: "Status filter" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "An email row" })).toBeInTheDocument();
  });

  test("picking an anchor saves it on that step", async () => {
    tutorialsGet.mockResolvedValue({ data: { tutorials: [unwritten] } });
    tutorialPut.mockResolvedValue({ data: { tutorial: unwritten } });

    renderTutorialsPage();
    await screen.findByText("Outbox");

    const user = await openEditDialog("Edit");
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByLabelText("Title"), "Filtering the outbox");
    await user.type(within(dialog).getByLabelText("Step 1 title"), "Status");
    await user.type(
      within(dialog).getByLabelText("Step 1 body"),
      "Filter down to failed or pending emails.",
    );
    await user.click(
      within(dialog).getByRole("combobox", { name: "Step 1 points at" }),
    );
    await user.click(await screen.findByRole("option", { name: "Status filter" }));

    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(tutorialPut).toHaveBeenCalledTimes(1));
    const [, body] = tutorialPut.mock.calls[0] as [
      string,
      { steps: { anchor?: string }[] },
    ];
    expect(body.steps[0]?.anchor).toBe("status");
  });
});
