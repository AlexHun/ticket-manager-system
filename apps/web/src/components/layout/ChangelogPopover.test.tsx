import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { renderWithQuery } from "@/test/render";
import { ChangelogPopover } from "./ChangelogPopover";

// --- Mocks ------------------------------------------------------------------

const mockGet = vi.fn();
const mockPost = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

// Real `compareVersions` and everything else, only `CHANGELOG_ENTRIES` swapped
// for a small fixture — see `changelog.test.ts` on the API side for the same
// spread-the-real-module reasoning. In recorded order, which is what CI
// appends: two entries share 0.5.10 because that deploy's branch carried two
// feat/fix commits (issue #113).
vi.mock("@ticket/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ticket/shared")>();
  return {
    ...actual,
    CHANGELOG_ENTRIES: [
      { version: "0.5.9", date: "2026-08-20", title: "An older change" },
      { version: "0.5.10", date: "2026-08-29", title: "A newer change" },
      { version: "0.5.10", date: "2026-08-29", title: "Another newer change" },
    ],
  };
});

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockPost.mockResolvedValue({ data: { ok: true } });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ChangelogPopover", () => {
  test("shows a dot when the caller has unseen entries", async () => {
    mockGet.mockResolvedValue({ data: { shouldShow: true } });
    renderWithQuery(<ChangelogPopover />);

    await waitFor(() =>
      expect(screen.getByTestId("changelog-dot")).toBeInTheDocument(),
    );
  });

  test("shows no dot once everything has been seen", async () => {
    mockGet.mockResolvedValue({ data: { shouldShow: false } });
    renderWithQuery(<ChangelogPopover />);

    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("changelog-dot")).not.toBeInTheDocument();
  });

  // Two entries at 0.5.10: a deploy's branch can carry two feat/fix commits,
  // and both are listed, in the order CI recorded them (issue #113).
  test("opening the popover lists entries newest-first", async () => {
    mockGet.mockResolvedValue({ data: { shouldShow: false } });
    const user = userEvent.setup();
    renderWithQuery(<ChangelogPopover />);

    await user.click(screen.getByRole("button", { name: "What's new" }));

    const items = await screen.findAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("A newer change");
    expect(items[1]).toHaveTextContent("Another newer change");
    expect(items[2]).toHaveTextContent("An older change");
  });

  test("opening while unseen marks the changelog seen", async () => {
    mockGet.mockResolvedValue({ data: { shouldShow: true } });
    const user = userEvent.setup();
    renderWithQuery(<ChangelogPopover />);

    await waitFor(() =>
      expect(screen.getByTestId("changelog-dot")).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "What's new" }));

    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/api/changelog/seen"));
  });

  test("opening while already seen does not write again", async () => {
    mockGet.mockResolvedValue({ data: { shouldShow: false } });
    const user = userEvent.setup();
    renderWithQuery(<ChangelogPopover />);

    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "What's new" }));

    expect(mockPost).not.toHaveBeenCalled();
  });
});
