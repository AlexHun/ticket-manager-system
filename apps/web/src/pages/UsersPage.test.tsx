import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { USER_ROLE, type User } from "@ticket/shared";
import { toast } from "@/components/ui/sonner";
import { apiStub } from "@/test/api-stub";
import { renderRoutes } from "@/test/render";
import { UsersPage } from "./UsersPage";

// --- Mocks ----------------------------------------------------------------

vi.mock("@/lib/api", () => import("@/test/api-stub"));

// The roster and the three writes against it. The invite POST gets its own
// path rather than sharing `usersPost`'s counter, so "only the initial users
// fetch" and "POST /api/users was never called" each mean what they say. The
// `<Tutorial>` mounted on this page is answered by the stub's own default.
const usersGet = apiStub.get("/api/users");
const usersPost = apiStub.post("/api/users");
const invitePost = apiStub.post("/api/users/:id/invite");
const userDelete = apiStub.delete("/api/users/:id");

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({
    data: { user: { name: "Admin User", role: USER_ROLE.admin } },
    isPending: false,
  }),
  authClient: { signOut: vi.fn() },
}));

// --- Helpers --------------------------------------------------------------

const adminUser: User = {
  id: "u_1",
  name: "Ada Admin",
  email: "admin@example.com",
  role: USER_ROLE.admin,
  emailVerified: true,
  automated: false,
  createdAt: "2025-01-15T12:00:00.000Z",
};

const agentUser: User = {
  id: "u_2",
  name: "Aaron Agent",
  email: "agent@example.com",
  role: USER_ROLE.agent,
  emailVerified: false,
  automated: false,
  createdAt: "2025-02-20T12:00:00.000Z",
};

const newAgentUser: User = {
  id: "u_3",
  name: "Nora New",
  email: "nora@example.com",
  role: USER_ROLE.agent,
  emailVerified: false,
  automated: false,
  createdAt: "2025-03-10T12:00:00.000Z",
};

/**
 * The assistant. On the roster so an admin can see what tickets are filed
 * under, and read-only there because every route that writes to it 403s.
 */
const automatedUser: User = {
  id: "u_bot",
  name: "Assistant",
  email: "assistant@example.com",
  role: USER_ROLE.agent,
  emailVerified: true,
  automated: true,
  createdAt: "2025-01-01T12:00:00.000Z",
};

/** On the real router, at the page's own path — as a navigation would match it. */
function renderUsersPage() {
  return renderRoutes([{ path: "/users", Component: UsersPage }], {
    initialEntries: ["/users"],
  });
}

async function openNewUserDialog() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "New user" }));
  return user;
}

// --- Tests ----------------------------------------------------------------

beforeEach(() => {
  apiStub.reset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("UsersPage", () => {
  // No heading test here any more: the <h1> moved to the shell's top bar, which
  // this page no longer renders. user-management.spec.ts covers it end to end.

  test("renders the skeleton table while the request is pending", () => {
    usersGet.mockReturnValue(new Promise(() => {}));
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
    usersGet.mockResolvedValue({ data: { users: [adminUser, agentUser] } });
    renderUsersPage();

    expect(await screen.findByText("Ada Admin")).toBeInTheDocument();
    expect(screen.getByText("Aaron Agent")).toBeInTheDocument();
    expect(screen.getByText("admin@example.com")).toBeInTheDocument();
    expect(screen.getByText("agent@example.com")).toBeInTheDocument();

    // Skeleton gone
    expect(screen.queryByLabelText("Loading users")).not.toBeInTheDocument();
  });

  // #111: the mechanism is covered in table-frame.test.tsx; this holds the name
  // this page gives it, which is the half that can drift per call site.
  test("puts the roster in a keyboard-reachable region named Users", async () => {
    usersGet.mockResolvedValue({ data: { users: [adminUser, agentUser] } });
    renderUsersPage();

    expect(await screen.findByText("Ada Admin")).toBeInTheDocument();
    const frame = screen.getByRole("region", { name: "Users" });
    expect(frame).toHaveAttribute("tabindex", "0");
    expect(frame).toContainElement(screen.getByRole("table"));
  });

  test("calls GET /api/users with a cancellation signal", async () => {
    usersGet.mockResolvedValue({ data: { users: [adminUser] } });
    renderUsersPage();

    await screen.findByText("Ada Admin");

    expect(usersGet).toHaveBeenCalledTimes(1);
    const [url, options] = usersGet.mock.calls[0] as [string, { signal: AbortSignal }];
    expect(url).toBe("/api/users");
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  test("renders admin and agent role badges with distinct variants", async () => {
    usersGet.mockResolvedValue({ data: { users: [adminUser, agentUser] } });
    renderUsersPage();

    const adminBadge = await screen.findByText(USER_ROLE.admin);
    const agentBadge = screen.getByText(USER_ROLE.agent);

    expect(adminBadge).toHaveAttribute("data-slot", "badge");
    expect(adminBadge).toHaveAttribute("data-variant", "default");
    expect(agentBadge).toHaveAttribute("data-slot", "badge");
    expect(agentBadge).toHaveAttribute("data-variant", "secondary");
  });

  test("shows no verification badge — the app has no verification flow", async () => {
    usersGet.mockResolvedValue({ data: { users: [adminUser, agentUser] } });
    renderUsersPage();

    await screen.findByText("Ada Admin");

    expect(screen.queryByText("Verified")).not.toBeInTheDocument();
    expect(screen.queryByText("Unverified")).not.toBeInTheDocument();
  });

  test("renders the createdAt as a localised date", async () => {
    usersGet.mockResolvedValue({ data: { users: [adminUser] } });
    renderUsersPage();

    const row = (await screen.findByText("Ada Admin")).closest("tr");
    if (!row) throw new Error("row not found");

    const expected = new Date(adminUser.createdAt).toLocaleDateString();
    expect(within(row).getByText(expected)).toBeInTheDocument();
  });

  test("renders an empty-state message when no users are returned", async () => {
    usersGet.mockResolvedValue({ data: { users: [] } });
    renderUsersPage();

    expect(await screen.findByText("No users found.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  test("renders an alert when the request fails", async () => {
    usersGet.mockRejectedValue(new Error("boom"));
    renderUsersPage();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("boom");
    // Table must not render
    expect(screen.queryByText("Ada Admin")).not.toBeInTheDocument();
  });

  test("renders the column headers", async () => {
    usersGet.mockResolvedValue({ data: { users: [adminUser] } });
    renderUsersPage();

    await screen.findByText("Ada Admin");

    for (const header of ["Name", "Email", "Role", "Created", "Actions"]) {
      expect(
        screen.getByRole("columnheader", { name: header }),
      ).toBeInTheDocument();
    }
  });

  test("the skeleton declares the same column headers as the table", () => {
    // Both render through UsersTableHead, so a column added to one can't be
    // missed on the other — see the comment on UsersTableHead in
    // UsersTable.tsx.
    usersGet.mockReturnValue(new Promise(() => {}));
    renderUsersPage();

    const skeleton = screen.getByLabelText("Loading users");
    for (const header of ["Name", "Email", "Role", "Created", "Actions"]) {
      expect(
        within(skeleton).getByRole("columnheader", { name: header }),
      ).toBeInTheDocument();
    }
  });

  test("does not flash the skeleton after data arrives", async () => {
    usersGet.mockResolvedValue({ data: { users: [adminUser] } });
    renderUsersPage();

    await waitFor(() => {
      expect(screen.queryByLabelText("Loading users")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Ada Admin")).toBeInTheDocument();
  });
});

describe("UsersPage — create user", () => {
  test("renders the New user button above the table", async () => {
    usersGet.mockResolvedValue({ data: { users: [adminUser] } });
    renderUsersPage();

    await screen.findByText("Ada Admin");
    expect(screen.getByRole("button", { name: "New user" })).toBeInTheDocument();
  });

  test("opens the dialog with name and email fields", async () => {
    usersGet.mockResolvedValue({ data: { users: [] } });
    renderUsersPage();

    await openNewUserDialog();

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Create user" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Name")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Email")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Create user" }),
    ).toBeInTheDocument();
  });

  test("shows a validation error when name is shorter than 3 characters", async () => {
    usersGet.mockResolvedValue({ data: { users: [] } });
    renderUsersPage();

    const user = await openNewUserDialog();
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByLabelText("Name"), "Jo");
    await user.type(within(dialog).getByLabelText("Email"), "ok@example.com");
    await user.click(within(dialog).getByRole("button", { name: "Create user" }));

    expect(
      await within(dialog).findByText("Name must be at least 3 characters"),
    ).toBeInTheDocument();
    expect(usersPost).not.toHaveBeenCalled();
  });

  test("shows a validation error when email is invalid", async () => {
    usersGet.mockResolvedValue({ data: { users: [] } });
    renderUsersPage();

    const user = await openNewUserDialog();
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByLabelText("Name"), "Valid Name");
    await user.type(within(dialog).getByLabelText("Email"), "not-an-email");
    await user.click(within(dialog).getByRole("button", { name: "Create user" }));

    expect(
      await within(dialog).findByText("Enter a valid email"),
    ).toBeInTheDocument();
    expect(usersPost).not.toHaveBeenCalled();
  });

  test("submits POST /api/users, closes the dialog, and refetches the list on success", async () => {
    usersGet
      .mockResolvedValueOnce({ data: { users: [adminUser] } })
      .mockResolvedValueOnce({ data: { users: [adminUser, newAgentUser] } });
    usersPost.mockResolvedValue({ data: { user: newAgentUser } });

    renderUsersPage();
    await screen.findByText("Ada Admin");

    const user = await openNewUserDialog();
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByLabelText("Name"), "Nora New");
    await user.type(within(dialog).getByLabelText("Email"), "nora@example.com");
    await user.click(within(dialog).getByRole("button", { name: "Create user" }));

    await waitFor(() => {
      expect(usersPost).toHaveBeenCalledTimes(1);
    });
    const [postUrl, postBody] = usersPost.mock.calls[0] as [
      string,
      { name: string; email: string },
    ];
    expect(postUrl).toBe("/api/users");
    expect(postBody).toEqual({
      name: "Nora New",
      email: "nora@example.com",
    });

    // Dialog closes
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    // List refetched and shows the new row
    expect(await screen.findByText("Nora New")).toBeInTheDocument();
    expect(usersGet).toHaveBeenCalledTimes(2);
  });

  test("keeps the dialog open and shows the server error when POST fails", async () => {
    usersGet.mockResolvedValue({ data: { users: [adminUser] } });
    const axiosError = Object.assign(new Error("Request failed"), {
      isAxiosError: true,
      response: { status: 409, data: { error: "Email already in use" } },
    });
    usersPost.mockRejectedValue(axiosError);

    renderUsersPage();
    await screen.findByText("Ada Admin");

    const user = await openNewUserDialog();
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByLabelText("Name"), "Dup Name");
    await user.type(within(dialog).getByLabelText("Email"), "dup@example.com");
    await user.click(within(dialog).getByRole("button", { name: "Create user" }));

    expect(
      await within(dialog).findByText("Email already in use"),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // Only the initial users fetch
    expect(usersGet).toHaveBeenCalledTimes(1);
  });
});

describe("UsersPage — delete user", () => {
  test("renders a Delete button for each agent row and hides it for admins", async () => {
    usersGet.mockResolvedValue({ data: { users: [adminUser, agentUser] } });
    renderUsersPage();
    await screen.findByText("Ada Admin");

    expect(
      screen.getByRole("button", { name: "Delete Aaron Agent" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Delete Ada Admin/ }),
    ).not.toBeInTheDocument();
  });

  test("opens a confirmation dialog with the user's name and email", async () => {
    usersGet.mockResolvedValue({ data: { users: [agentUser] } });
    renderUsersPage();
    await screen.findByText("Aaron Agent");

    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Delete Aaron Agent" }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Delete user" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Aaron Agent/),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/agent@example\.com/),
    ).toBeInTheDocument();
  });

  test("Cancel closes the dialog without calling DELETE", async () => {
    usersGet.mockResolvedValue({ data: { users: [agentUser] } });
    renderUsersPage();
    await screen.findByText("Aaron Agent");

    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Delete Aaron Agent" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(userDelete).not.toHaveBeenCalled();
  });

  test("confirming calls DELETE /api/users/:id, closes the dialog, and refetches", async () => {
    usersGet
      .mockResolvedValueOnce({ data: { users: [adminUser, agentUser] } })
      .mockResolvedValueOnce({ data: { users: [adminUser] } });
    userDelete.mockResolvedValue({ data: {} });

    renderUsersPage();
    await screen.findByText("Aaron Agent");

    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Delete Aaron Agent" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Delete user" }),
    );

    await waitFor(() => {
      expect(userDelete).toHaveBeenCalledTimes(1);
    });
    expect(userDelete.mock.calls[0]?.[0]).toBe("/api/users/u_2");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.queryByText("Aaron Agent")).not.toBeInTheDocument();
    });
    expect(usersGet).toHaveBeenCalledTimes(2);
  });

  test("keeps the dialog open and shows the server error when DELETE fails", async () => {
    usersGet.mockResolvedValue({ data: { users: [adminUser, agentUser] } });
    const axiosError = Object.assign(new Error("Request failed"), {
      isAxiosError: true,
      response: { status: 403, data: { error: "Admin users cannot be deleted" } },
    });
    userDelete.mockRejectedValue(axiosError);

    renderUsersPage();
    await screen.findByText("Aaron Agent");

    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Delete Aaron Agent" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Delete user" }),
    );

    expect(
      await within(dialog).findByText("Admin users cannot be deleted"),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // No refetch on failure
    expect(usersGet).toHaveBeenCalledTimes(1);
  });
});

describe("UsersPage — resend invite", () => {
  test("renders a resend button on every real row, admins included", async () => {
    // Not gated on `emailVerified`: `adminUser` has it true and still gets the
    // button. An admin locked out of their own account is exactly who needs it,
    // and the column means nothing here — see ADR 0010 and the comment in
    // UsersTable.tsx.
    usersGet.mockResolvedValue({ data: { users: [adminUser, agentUser] } });
    renderUsersPage();
    await screen.findByText("Ada Admin");

    expect(
      screen.getByRole("button", { name: "Resend invitation to Ada Admin" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Resend invitation to Aaron Agent" }),
    ).toBeInTheDocument();
  });

  test("hides the resend button on the assistant's row", async () => {
    usersGet.mockResolvedValue({ data: { users: [agentUser, automatedUser] } });
    renderUsersPage();
    // Anchored on the address, not the name: the row carries "Assistant" twice
    // — once as the name and once as the badge that replaces its role.
    await screen.findByText("assistant@example.com");

    expect(
      screen.queryByRole("button", { name: /Resend invitation to Assistant/ }),
    ).not.toBeInTheDocument();
    // The other row actions stay hidden on it too — one rule, not three.
    expect(
      screen.queryByRole("button", { name: /^Edit Assistant/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Delete Assistant/ }),
    ).not.toBeInTheDocument();
  });

  test("clicking it POSTs to /api/users/:id/invite and toasts success", async () => {
    usersGet.mockResolvedValue({ data: { users: [agentUser] } });
    invitePost.mockResolvedValue({ data: {} });

    renderUsersPage();
    await screen.findByText("Aaron Agent");

    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Resend invitation to Aaron Agent" }),
    );

    await waitFor(() => {
      expect(invitePost).toHaveBeenCalledTimes(1);
    });
    expect(invitePost.mock.calls[0]?.[0]).toBe("/api/users/u_2/invite");

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        'Invitation resent to "Aaron Agent" (agent@example.com)',
      );
    });
    // Nothing on the roster changed, so nothing refetches it.
    expect(usersGet).toHaveBeenCalledTimes(1);
  });

  test("toasts the server's message when the invite fails", async () => {
    usersGet.mockResolvedValue({ data: { users: [agentUser] } });
    invitePost.mockRejectedValue(
      Object.assign(new Error("Request failed"), {
        isAxiosError: true,
        response: { status: 404, data: { error: "User not found" } },
      }),
    );

    renderUsersPage();
    await screen.findByText("Aaron Agent");

    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Resend invitation to Aaron Agent" }),
    );

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("User not found");
    });
    expect(toast.success).not.toHaveBeenCalled();
  });

  test("only the clicked row's button goes pending", async () => {
    // The reason the mutation sits in ResendInviteButton rather than on the
    // page: one shared `isPending` would disable every row at once.
    usersGet.mockResolvedValue({ data: { users: [adminUser, agentUser] } });
    invitePost.mockReturnValue(new Promise(() => {}));

    renderUsersPage();
    await screen.findByText("Aaron Agent");

    const clicked = screen.getByRole("button", {
      name: "Resend invitation to Aaron Agent",
    });
    const other = screen.getByRole("button", {
      name: "Resend invitation to Ada Admin",
    });

    const user = userEvent.setup();
    await user.click(clicked);

    await waitFor(() => {
      expect(clicked).toBeDisabled();
    });
    expect(other).toBeEnabled();
  });
});
