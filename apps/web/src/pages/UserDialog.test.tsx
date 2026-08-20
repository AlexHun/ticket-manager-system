import { useState } from "react";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { USER_ROLE, type User } from "@ticket/shared";
import { renderWithQuery } from "@/test/render";
import { UserDialog } from "./UserDialog";

const mockPost = vi.fn();
const mockPatch = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    post: (...args: unknown[]) => mockPost(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
  },
}));

const baseUser: User = {
  id: "u_42",
  name: "Aaron Agent",
  email: "agent@example.com",
  role: USER_ROLE.agent,
  emailVerified: false,
  automated: false,
  createdAt: "2026-04-01T12:00:00.000Z",
};

const otherUser: User = {
  id: "u_43",
  name: "Beth Beta",
  email: "beth@example.com",
  role: USER_ROLE.admin,
  emailVerified: true,
  automated: false,
  createdAt: "2026-04-02T12:00:00.000Z",
};

const newAgent: User = {
  id: "u_new",
  name: "Nora New",
  email: "nora@example.com",
  role: USER_ROLE.agent,
  emailVerified: false,
  automated: false,
  createdAt: "2026-04-03T12:00:00.000Z",
};

function Harness({ users }: { users: User[] }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setEditing(null);
          setOpen(true);
        }}
      >
        New user
      </button>
      {users.map((u) => (
        <button
          key={u.id}
          type="button"
          onClick={() => {
            setEditing(u);
            setOpen(true);
          }}
        >
          Edit {u.name}
        </button>
      ))}
      <UserDialog user={editing} open={open} onOpenChange={setOpen} />
    </>
  );
}

function renderHarness(users: User[] = [baseUser, otherUser]) {
  return renderWithQuery(<Harness users={users} />);
}

async function openCreate() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "New user" }));
  await screen.findByRole("dialog");
  return user;
}

async function openEdit(name: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: `Edit ${name}` }));
  const dialog = await screen.findByRole("dialog");
  await waitFor(() => {
    expect(within(dialog).getByLabelText("Name")).toHaveValue(name);
  });
  return user;
}

beforeEach(() => {
  mockPost.mockReset();
  mockPatch.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("UserDialog — create mode", () => {
  test("opens with empty form and 'Create user' heading", async () => {
    renderHarness();
    await openCreate();

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Create user" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Name")).toHaveValue("");
    expect(within(dialog).getByLabelText("Email")).toHaveValue("");
  });

  test("submits POST /api/users and closes on success", async () => {
    mockPost.mockResolvedValue({ data: { user: newAgent } });

    renderHarness();
    const user = await openCreate();
    const dialog = screen.getByRole("dialog");

    await user.type(within(dialog).getByLabelText("Name"), "Nora New");
    await user.type(within(dialog).getByLabelText("Email"), "nora@example.com");
    await user.click(within(dialog).getByRole("button", { name: "Create user" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(mockPost).toHaveBeenCalledTimes(1);
    const [url, body] = mockPost.mock.calls[0] as [
      string,
      { name: string; email: string },
    ];
    expect(url).toBe("/api/users");
    expect(body).toEqual({
      name: "Nora New",
      email: "nora@example.com",
    });
    // The account is created without one; the new colleague sets their own from
    // the invitation link. A password reaching this endpoint would mean the
    // form had grown a field back.
    expect(body).not.toHaveProperty("password");
    expect(mockPatch).not.toHaveBeenCalled();
  });
});

describe("UserDialog — edit mode", () => {
  test("opens pre-populated with name and email, 'Edit user' heading", async () => {
    renderHarness();
    await openEdit("Aaron Agent");

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Edit user" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Aaron Agent");
    expect(within(dialog).getByLabelText("Email")).toHaveValue("agent@example.com");
  });

  test("PATCH sends name and email only, closes on success", async () => {
    mockPatch.mockResolvedValue({ data: { user: baseUser } });

    renderHarness();
    const user = await openEdit("Aaron Agent");
    const dialog = screen.getByRole("dialog");

    const nameInput = within(dialog).getByLabelText("Name");
    await user.clear(nameInput);
    await user.type(nameInput, "Aaron Updated");
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledTimes(1);
    });
    const [url, body] = mockPatch.mock.calls[0] as [
      string,
      Record<string, string>,
    ];
    expect(url).toBe("/api/users/u_42");
    expect(body).toEqual({
      name: "Aaron Updated",
      email: "agent@example.com",
    });
    expect(body).not.toHaveProperty("password");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(mockPost).not.toHaveBeenCalled();
  });

  test("switching to a different user repopulates the form", async () => {
    renderHarness();
    const user = await openEdit("Aaron Agent");

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    await openEdit("Beth Beta");
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Beth Beta");
    expect(within(dialog).getByLabelText("Email")).toHaveValue("beth@example.com");
  });
});

describe("UserDialog — mode transitions", () => {
  test("closing edit then opening create clears the prepopulated fields", async () => {
    renderHarness();
    const user = await openEdit("Aaron Agent");

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    await openCreate();
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Create user" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Name")).toHaveValue("");
    expect(within(dialog).getByLabelText("Email")).toHaveValue("");
  });

  test("closing create then opening edit populates from the selected user", async () => {
    renderHarness();
    const user = await openCreate();
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "Stale");

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    await openEdit("Beth Beta");
    const reopened = screen.getByRole("dialog");
    expect(
      within(reopened).getByRole("heading", { name: "Edit user" }),
    ).toBeInTheDocument();
    expect(within(reopened).getByLabelText("Name")).toHaveValue("Beth Beta");
  });
});

describe("UserDialog — open/close & errors", () => {
  test("Escape closes the dialog", async () => {
    renderHarness();
    const user = await openEdit("Aaron Agent");

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  test("clicking the X close button closes the dialog", async () => {
    renderHarness();
    const user = await openCreate();

    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  test("dialog stays open and shows server error on PATCH failure", async () => {
    const axiosError = Object.assign(new Error("Request failed"), {
      isAxiosError: true,
      response: { status: 409, data: { error: "Email already in use" } },
    });
    mockPatch.mockRejectedValue(axiosError);

    renderHarness();
    const user = await openEdit("Aaron Agent");
    const dialog = screen.getByRole("dialog");

    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );

    expect(
      await within(dialog).findByText("Email already in use"),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  test("reopening after a server error clears the error message", async () => {
    const axiosError = Object.assign(new Error("Request failed"), {
      isAxiosError: true,
      response: { status: 500, data: { error: "Database unavailable" } },
    });
    mockPatch.mockRejectedValue(axiosError);

    renderHarness();
    const user = await openEdit("Aaron Agent");
    const dialog = screen.getByRole("dialog");

    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );

    expect(
      await within(dialog).findByText("Database unavailable"),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    await openEdit("Aaron Agent");
    expect(screen.queryByText("Database unavailable")).not.toBeInTheDocument();
  });
});
