import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { User } from "@ticket/shared";
import { renderWithQuery } from "@/test/render";
import { UsersPage } from "./UsersPage";

// --- Mocks ----------------------------------------------------------------

const mockGet = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
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

function renderUsersPage() {
  return renderWithQuery(<UsersPage />, { initialEntries: ["/users"] });
}

// --- Tests ----------------------------------------------------------------

beforeEach(() => {
  mockGet.mockReset();
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
