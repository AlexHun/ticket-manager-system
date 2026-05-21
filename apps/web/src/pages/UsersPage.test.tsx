import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { User } from "@ticket/shared";
import { renderWithQuery } from "@/test/render";
import { UsersPage } from "./UsersPage";

// --- Mocks ----------------------------------------------------------------

const mockGet = vi.fn();
const mockPost = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({
    data: { user: { name: "Admin User", role: "admin" } },
    isPending: false,
  }),
  authClient: { signOut: vi.fn() },
}));

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ theme: "dark", toggleTheme: vi.fn() }),
}));

// --- Helpers --------------------------------------------------------------

const adminUser: User = {
  id: "u_1",
  name: "Ada Admin",
  email: "admin@example.com",
  role: "admin",
  emailVerified: true,
  createdAt: "2025-01-15T12:00:00.000Z",
};

const agentUser: User = {
  id: "u_2",
  name: "Aaron Agent",
  email: "agent@example.com",
  role: "agent",
  emailVerified: false,
  createdAt: "2025-02-20T12:00:00.000Z",
};

const newAgentUser: User = {
  id: "u_3",
  name: "Nora New",
  email: "nora@example.com",
  role: "agent",
  emailVerified: false,
  createdAt: "2025-03-10T12:00:00.000Z",
};

function renderUsersPage() {
  return renderWithQuery(<UsersPage />, { initialEntries: ["/users"] });
}

async function openNewUserDialog() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "New user" }));
  return user;
}

// --- Tests ----------------------------------------------------------------

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("UsersPage", () => {
  test("shows the page heading", () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    renderUsersPage();
    expect(
      screen.getByRole("heading", { name: "Users", level: 1 }),
    ).toBeInTheDocument();
  });

  test("renders the skeleton table while the request is pending", () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    renderUsersPage();

    expect(screen.getByLabelText("Loading users")).toBeInTheDocument();
    expect(screen.getByLabelText("Loading users")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    // No data rows yet
    expect(screen.queryByText("Ada Admin")).not.toBeInTheDocument();
  });

  test("renders a row per user once the query resolves", async () => {
    mockGet.mockResolvedValue({ data: { users: [adminUser, agentUser] } });
    renderUsersPage();

    expect(await screen.findByText("Ada Admin")).toBeInTheDocument();
    expect(screen.getByText("Aaron Agent")).toBeInTheDocument();
    expect(screen.getByText("admin@example.com")).toBeInTheDocument();
    expect(screen.getByText("agent@example.com")).toBeInTheDocument();

    // Skeleton gone
    expect(screen.queryByLabelText("Loading users")).not.toBeInTheDocument();
  });

  test("calls GET /api/users with a cancellation signal", async () => {
    mockGet.mockResolvedValue({ data: { users: [adminUser] } });
    renderUsersPage();

    await screen.findByText("Ada Admin");

    expect(mockGet).toHaveBeenCalledTimes(1);
    const [url, options] = mockGet.mock.calls[0] as [string, { signal: AbortSignal }];
    expect(url).toBe("/api/users");
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  test("renders admin and agent role badges with distinct variants", async () => {
    mockGet.mockResolvedValue({ data: { users: [adminUser, agentUser] } });
    renderUsersPage();

    const adminBadge = await screen.findByText("admin");
    const agentBadge = screen.getByText("agent");

    expect(adminBadge).toHaveAttribute("data-slot", "badge");
    expect(adminBadge).toHaveAttribute("data-variant", "default");
    expect(agentBadge).toHaveAttribute("data-slot", "badge");
    expect(agentBadge).toHaveAttribute("data-variant", "secondary");
  });

  test("shows a verified badge for verified users and unverified otherwise", async () => {
    mockGet.mockResolvedValue({ data: { users: [adminUser, agentUser] } });
    renderUsersPage();

    const adminRow = (await screen.findByText("Ada Admin")).closest("tr");
    const agentRow = screen.getByText("Aaron Agent").closest("tr");
    if (!adminRow || !agentRow) throw new Error("rows not found");

    expect(within(adminRow).getByText("Verified")).toBeInTheDocument();
    expect(within(agentRow).getByText("Unverified")).toBeInTheDocument();
  });

  test("renders the createdAt as a localised date", async () => {
    mockGet.mockResolvedValue({ data: { users: [adminUser] } });
    renderUsersPage();

    const row = (await screen.findByText("Ada Admin")).closest("tr");
    if (!row) throw new Error("row not found");

    const expected = new Date(adminUser.createdAt).toLocaleDateString();
    expect(within(row).getByText(expected)).toBeInTheDocument();
  });

  test("renders an empty-state message when no users are returned", async () => {
    mockGet.mockResolvedValue({ data: { users: [] } });
    renderUsersPage();

    expect(await screen.findByText("No users found.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  test("renders an alert when the request fails", async () => {
    mockGet.mockRejectedValue(new Error("boom"));
    renderUsersPage();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("boom");
    // Table must not render
    expect(screen.queryByText("Ada Admin")).not.toBeInTheDocument();
  });

  test("renders the column headers", async () => {
    mockGet.mockResolvedValue({ data: { users: [adminUser] } });
    renderUsersPage();

    await screen.findByText("Ada Admin");

    for (const header of ["Name", "Email", "Role", "Verified", "Created"]) {
      expect(
        screen.getByRole("columnheader", { name: header }),
      ).toBeInTheDocument();
    }
  });

  test("does not flash the skeleton after data arrives", async () => {
    mockGet.mockResolvedValue({ data: { users: [adminUser] } });
    renderUsersPage();

    await waitFor(() => {
      expect(screen.queryByLabelText("Loading users")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Ada Admin")).toBeInTheDocument();
  });
});

describe("UsersPage — create user", () => {
  test("renders the New user button above the table", async () => {
    mockGet.mockResolvedValue({ data: { users: [adminUser] } });
    renderUsersPage();

    await screen.findByText("Ada Admin");
    expect(screen.getByRole("button", { name: "New user" })).toBeInTheDocument();
  });

  test("opens the dialog with name, email, password fields", async () => {
    mockGet.mockResolvedValue({ data: { users: [] } });
    renderUsersPage();

    await openNewUserDialog();

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Create user" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Name")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Email")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Password")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Create user" }),
    ).toBeInTheDocument();
  });

  test("shows a validation error when name is shorter than 3 characters", async () => {
    mockGet.mockResolvedValue({ data: { users: [] } });
    renderUsersPage();

    const user = await openNewUserDialog();
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByLabelText("Name"), "Jo");
    await user.type(within(dialog).getByLabelText("Email"), "ok@example.com");
    await user.type(within(dialog).getByLabelText("Password"), "longenoughpw");
    await user.click(within(dialog).getByRole("button", { name: "Create user" }));

    expect(
      await within(dialog).findByText("Name must be at least 3 characters"),
    ).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  test("shows a validation error when email is invalid", async () => {
    mockGet.mockResolvedValue({ data: { users: [] } });
    renderUsersPage();

    const user = await openNewUserDialog();
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByLabelText("Name"), "Valid Name");
    await user.type(within(dialog).getByLabelText("Email"), "not-an-email");
    await user.type(within(dialog).getByLabelText("Password"), "longenoughpw");
    await user.click(within(dialog).getByRole("button", { name: "Create user" }));

    expect(
      await within(dialog).findByText("Enter a valid email"),
    ).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  test("shows a validation error when password is shorter than 8 characters", async () => {
    mockGet.mockResolvedValue({ data: { users: [] } });
    renderUsersPage();

    const user = await openNewUserDialog();
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByLabelText("Name"), "Valid Name");
    await user.type(within(dialog).getByLabelText("Email"), "ok@example.com");
    await user.type(within(dialog).getByLabelText("Password"), "short");
    await user.click(within(dialog).getByRole("button", { name: "Create user" }));

    expect(
      await within(dialog).findByText("Password must be at least 8 characters"),
    ).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  test("submits POST /api/users, closes the dialog, and refetches the list on success", async () => {
    mockGet
      .mockResolvedValueOnce({ data: { users: [adminUser] } })
      .mockResolvedValueOnce({ data: { users: [adminUser, newAgentUser] } });
    mockPost.mockResolvedValue({ data: { user: newAgentUser } });

    renderUsersPage();
    await screen.findByText("Ada Admin");

    const user = await openNewUserDialog();
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByLabelText("Name"), "Nora New");
    await user.type(within(dialog).getByLabelText("Email"), "nora@example.com");
    await user.type(within(dialog).getByLabelText("Password"), "password123");
    await user.click(within(dialog).getByRole("button", { name: "Create user" }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledTimes(1);
    });
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

    // Dialog closes
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    // List refetched and shows the new row
    expect(await screen.findByText("Nora New")).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  test("keeps the dialog open and shows the server error when POST fails", async () => {
    mockGet.mockResolvedValue({ data: { users: [adminUser] } });
    const axiosError = Object.assign(new Error("Request failed"), {
      isAxiosError: true,
      response: { status: 409, data: { error: "Email already in use" } },
    });
    mockPost.mockRejectedValue(axiosError);

    renderUsersPage();
    await screen.findByText("Ada Admin");

    const user = await openNewUserDialog();
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByLabelText("Name"), "Dup Name");
    await user.type(within(dialog).getByLabelText("Email"), "dup@example.com");
    await user.type(within(dialog).getByLabelText("Password"), "password123");
    await user.click(within(dialog).getByRole("button", { name: "Create user" }));

    expect(
      await within(dialog).findByText("Email already in use"),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // Only the initial users fetch
    expect(mockGet).toHaveBeenCalledTimes(1);
  });
});
