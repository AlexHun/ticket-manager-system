import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { User } from "@ticket/shared";
import { renderWithQuery } from "@/test/render";
import { NewUserDialog } from "./NewUserDialog";

const mockPost = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

const newAgent: User = {
  id: "u_new",
  name: "Nora New",
  email: "nora@example.com",
  role: "agent",
  emailVerified: false,
  createdAt: "2026-04-01T12:00:00.000Z",
};

function renderDialog() {
  return renderWithQuery(<NewUserDialog />);
}

async function openDialog() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "New user" }));
  await screen.findByRole("dialog");
  return user;
}

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  const dialog = screen.getByRole("dialog");
  await user.type(within(dialog).getByLabelText("Name"), "Nora New");
  await user.type(within(dialog).getByLabelText("Email"), "nora@example.com");
  await user.type(within(dialog).getByLabelText("Password"), "password123");
  return dialog;
}

beforeEach(() => {
  mockPost.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("NewUserDialog — open/close", () => {
  test("dialog is closed by default and trigger button is visible", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: "New user" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("clicking the trigger opens the dialog", async () => {
    renderDialog();
    await openDialog();

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Create user" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Name")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Email")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Password")).toBeInTheDocument();
  });

  test("pressing Escape closes the dialog", async () => {
    renderDialog();
    const user = await openDialog();

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  test("clicking the X close button closes the dialog", async () => {
    renderDialog();
    const user = await openDialog();

    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  test("clicking the overlay closes the dialog", async () => {
    renderDialog();
    const user = await openDialog();

    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    if (!overlay) throw new Error("dialog overlay not found");
    await user.click(overlay);

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  test("reopening after a manual close resets the form", async () => {
    renderDialog();
    const firstOpen = await openDialog();

    const firstDialog = screen.getByRole("dialog");
    await firstOpen.type(within(firstDialog).getByLabelText("Name"), "Stale");
    await firstOpen.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    await openDialog();

    const reopenedDialog = screen.getByRole("dialog");
    expect(within(reopenedDialog).getByLabelText("Name")).toHaveValue("");
    expect(within(reopenedDialog).getByLabelText("Email")).toHaveValue("");
    expect(within(reopenedDialog).getByLabelText("Password")).toHaveValue("");
  });

  test("reopening after a server error clears the error message", async () => {
    const axiosError = Object.assign(new Error("Request failed"), {
      isAxiosError: true,
      response: { status: 409, data: { error: "Email already in use" } },
    });
    mockPost.mockRejectedValue(axiosError);

    renderDialog();
    const user = await openDialog();
    const dialog = await fillValidForm(user);
    await user.click(within(dialog).getByRole("button", { name: "Create user" }));

    expect(
      await within(dialog).findByText("Email already in use"),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    await openDialog();
    expect(screen.queryByText("Email already in use")).not.toBeInTheDocument();
  });

  test("dialog auto-closes on successful submit", async () => {
    mockPost.mockResolvedValue({ data: { user: newAgent } });

    renderDialog();
    const user = await openDialog();
    const dialog = await fillValidForm(user);
    await user.click(within(dialog).getByRole("button", { name: "Create user" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    expect(mockPost).toHaveBeenCalledTimes(1);
    const [postUrl, postBody] = mockPost.mock.calls[0] as [
      string,
      { name: string; email: string; password: string },
    ];
    expect(postUrl).toBe("/api/users");
    expect(postBody).toEqual({
      name: "Nora New",
      email: "nora@example.com",
      password: "password123",
    });
  });

  test("dialog stays open on server error", async () => {
    const axiosError = Object.assign(new Error("Request failed"), {
      isAxiosError: true,
      response: { status: 500, data: { error: "Database unavailable" } },
    });
    mockPost.mockRejectedValue(axiosError);

    renderDialog();
    const user = await openDialog();
    const dialog = await fillValidForm(user);
    await user.click(within(dialog).getByRole("button", { name: "Create user" }));

    expect(
      await within(dialog).findByText("Database unavailable"),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

});
