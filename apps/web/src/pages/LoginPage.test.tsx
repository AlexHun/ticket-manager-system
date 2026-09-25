import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { USER_ROLE, type DemoStatusResponse } from "@ticket/shared";
import { apiStub } from "@/test/api-stub";
import { renderRoutes } from "@/test/render";
import { LoginPage } from "./LoginPage";

const mockSignInEmail = vi.fn();
const mockSignInAnonymous = vi.fn();
const mockUseSession = vi.fn();

vi.mock("@/lib/auth-client", () => ({
  signIn: {
    email: (...args: unknown[]) => mockSignInEmail(...args),
    anonymous: (...args: unknown[]) => mockSignInAnonymous(...args),
  },
  useSession: () => mockUseSession(),
}));

vi.mock("@/lib/api", () => import("@/test/api-stub"));

const demoGet = apiStub.get("/api/demo");

function demoMode(enabled: boolean) {
  demoGet.mockResolvedValue({ data: { enabled } satisfies DemoStatusResponse });
}

function renderLogin() {
  return renderRoutes(
    [
      { path: "/", element: <div>HOME</div> },
      { path: "/login", element: <LoginPage /> },
    ],
    { initialEntries: ["/login"] },
  );
}

beforeEach(() => {
  apiStub.reset();
  demoMode(false);
  mockSignInEmail.mockReset();
  mockSignInAnonymous.mockReset();
  mockUseSession.mockReset();
  mockUseSession.mockReturnValue({ data: null, isPending: false });
});

afterEach(() => {
  vi.clearAllMocks();
});

const CARD_DESCRIPTION =
  "Use your email and password to access the ticket manager.";

describe("LoginPage — rendering", () => {
  test("renders the sign-in card with both fields and submit button", () => {
    renderLogin();
    expect(screen.getByText(CARD_DESCRIPTION)).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  test("renders nothing but a loading spinner while the session is pending", () => {
    mockUseSession.mockReturnValue({ data: null, isPending: true });
    renderLogin();

    expect(screen.queryByText(CARD_DESCRIPTION)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });

  test("redirects to / when an authenticated session already exists", async () => {
    mockUseSession.mockReturnValue({
      data: { user: { id: "u_1", name: "Admin", role: USER_ROLE.admin } },
      isPending: false,
    });
    renderLogin();

    expect(await screen.findByText("HOME")).toBeInTheDocument();
    expect(screen.queryByText(CARD_DESCRIPTION)).not.toBeInTheDocument();
  });

  test("pre-fills email and password in DEV mode", () => {
    renderLogin();
    expect(screen.getByLabelText("Email")).toHaveValue("admin@example.com");
    expect(screen.getByLabelText("Password")).toHaveValue("password123");
  });
});

describe("LoginPage — validation", () => {
  test("shows a client-side error for an invalid email", async () => {
    renderLogin();
    const user = userEvent.setup();

    const emailInput = screen.getByLabelText("Email");
    await user.clear(emailInput);
    await user.type(emailInput, "not-an-email");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Enter a valid email")).toBeInTheDocument();
    expect(mockSignInEmail).not.toHaveBeenCalled();
  });

  test("shows a client-side error when password is empty", async () => {
    renderLogin();
    const user = userEvent.setup();

    await user.clear(screen.getByLabelText("Password"));
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Password is required")).toBeInTheDocument();
    expect(mockSignInEmail).not.toHaveBeenCalled();
  });
});

describe("LoginPage — submit", () => {
  test("calls signIn.email with the form values and navigates to / on success", async () => {
    mockSignInEmail.mockResolvedValue({ error: null });
    renderLogin();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(mockSignInEmail).toHaveBeenCalledTimes(1);
    });
    expect(mockSignInEmail.mock.calls[0]?.[0]).toEqual({
      email: "admin@example.com",
      password: "password123",
    });
    expect(await screen.findByText("HOME")).toBeInTheDocument();
  });

  test("shows the server error message when signIn.email returns an error", async () => {
    mockSignInEmail.mockResolvedValue({
      error: { message: "Invalid email or password" },
    });
    renderLogin();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Sign in" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Invalid email or password");
    // Stayed on /login — no redirect happened
    expect(screen.queryByText("HOME")).not.toBeInTheDocument();
  });

  test("falls back to a generic message when the error has no message", async () => {
    mockSignInEmail.mockResolvedValue({ error: {} });
    renderLogin();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByText("Invalid email or password"),
    ).toBeInTheDocument();
  });

  test("disables inputs and shows the loading label while submitting", async () => {
    let resolveSignIn!: (v: { error: null }) => void;
    mockSignInEmail.mockImplementation(
      () => new Promise((resolve) => (resolveSignIn = resolve)),
    );
    renderLogin();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Email")).toBeDisabled();
    });
    expect(screen.getByLabelText("Password")).toBeDisabled();
    expect(screen.getByRole("button", { name: /Signing in/i })).toBeDisabled();

    resolveSignIn({ error: null });
  });
});

/**
 * "Use demo session" (#319). The API's refusal is the real switch: `auth.ts`
 * turns `/sign-in/anonymous` away while demo mode is off. What is tested here
 * is the half no E2E can reach, because no web server in the suite fronts a
 * demo-off API: the button is absent unless the API says demo mode is on.
 */
describe("LoginPage — demo session", () => {
  const DEMO = { name: "Use demo session" };

  test("offers no demo button while demo mode is off", async () => {
    renderLogin();

    await waitFor(() => expect(demoGet).toHaveBeenCalled());
    // The form is there, so the page has rendered past the point of asking.
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByRole("button", DEMO)).not.toBeInTheDocument();
  });

  test("offers no demo button when the API cannot say", async () => {
    demoGet.mockRejectedValue(new Error("Network Error"));
    renderLogin();

    await waitFor(() => expect(demoGet).toHaveBeenCalled());
    expect(screen.queryByRole("button", DEMO)).not.toBeInTheDocument();
  });

  test("offers it while demo mode is on", async () => {
    demoMode(true);
    renderLogin();

    expect(await screen.findByRole("button", DEMO)).toBeEnabled();
  });

  test("one click signs in with no credential and lands on /", async () => {
    demoMode(true);
    mockSignInAnonymous.mockResolvedValue({ error: null });
    renderLogin();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", DEMO));

    expect(await screen.findByText("HOME")).toBeInTheDocument();
    expect(mockSignInAnonymous).toHaveBeenCalledTimes(1);
    expect(mockSignInEmail).not.toHaveBeenCalled();
  });

  test("disables both ways in while the demo is starting", async () => {
    demoMode(true);
    let resolve!: (v: { error: null }) => void;
    mockSignInAnonymous.mockImplementation(
      () => new Promise((r) => (resolve = r)),
    );
    renderLogin();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", DEMO));

    expect(
      await screen.findByRole("button", { name: /Starting demo/i }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
    expect(screen.getByLabelText("Email")).toBeDisabled();

    resolve({ error: null });
  });

  // Demo mode turned off between the page loading and the click: the button
  // was honest when drawn, and the refusal needs its own words rather than
  // "Invalid email or password" about a form nobody filled in.
  test("says so when the start is refused, and stays", async () => {
    demoMode(true);
    mockSignInAnonymous.mockResolvedValue({
      error: { status: 403, message: "Demo mode is off" },
    });
    renderLogin();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", DEMO));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Demo sessions are not available right now.",
    );
    expect(screen.queryByText("HOME")).not.toBeInTheDocument();
  });

  test("blames the connection, not the visitor, when the API is down", async () => {
    demoMode(true);
    mockSignInAnonymous.mockResolvedValue({
      error: { status: 502, message: "Bad Gateway" },
    });
    renderLogin();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", DEMO));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Can't reach the ticket manager.",
    );
  });
});
