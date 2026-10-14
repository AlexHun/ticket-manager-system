import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { apiStub } from "@/test/api-stub";
import { renderRoutes } from "@/test/render";
import { ChangelogPopover } from "./ChangelogPopover";

// A file of its own because `CHANGELOG_ENTRIES` is swapped at module level:
// `ChangelogPopover.test.tsx` needs three entries, this needs none.

vi.mock("@/lib/api", () => import("@/test/api-stub"));

const statusGet = apiStub.get("/api/changelog/status");

vi.mock("@ticket/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ticket/shared")>();
  return { ...actual, CHANGELOG_ENTRIES: [] };
});

beforeEach(() => {
  apiStub.reset();
  statusGet.mockResolvedValue({ data: { shouldShow: false } });
});

describe("ChangelogPopover with no entries", () => {
  test("says what will fill it", async () => {
    const user = userEvent.setup();
    renderRoutes([{ path: "/", element: <ChangelogPopover /> }]);

    await user.click(screen.getByRole("button", { name: "What's new" }));

    expect(
      await screen.findByText(
        "Nothing new yet. New features and fixes appear here as they ship.",
      ),
    ).toBeInTheDocument();
  });
});
