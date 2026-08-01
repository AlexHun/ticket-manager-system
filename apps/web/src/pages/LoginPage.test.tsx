import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Route, Routes } from "react-router-dom";
import { renderWithQuery } from "@/test/render";
import { LoginPage } from "./LoginPage";

const mockSignInEmail = vi.fn();
const mockUseSession = vi.fn();

vi.mock("@/lib/auth-client", () => ({
  signIn: {
    email: (...args: unknown[]) => mockSignInEmail(...args),
  },
  useSession: () => mockUseSession(),
}));

function renderLogin() {
  return renderWithQuery(
    <Routes>
      <Route path="/" element={<div>HOME</div>} />
      <Route path="/login" element={<LoginPage />} />
    </Routes>,
    { initialEntries: ["/login"] },
  );
}

beforeEach(() => {
  mockSignInEmail.mockReset();
  mockUseSession.mockReset();
  mockUseSession.mockReturnValue({ data: null, isPending: false });
});

afterEach(() => {
  vi.clearAllMocks();
});

const CARD_DESCRIPTION = "Use your email and password to access the ticket manager.";

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
      data: { user: { id: "u_1", name: "Admin", role: "admin" } },
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
