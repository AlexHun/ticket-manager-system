import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { authClient } from "@/lib/auth-client";
import { AUTH_UNREACHABLE_MESSAGE } from "@/lib/auth-failure";
import { ROUTE } from "@/lib/routes";
import { renderRoutes } from "@/test/render";
import {
  LINK_REFUSED,
  RESET_RATE_LIMITED,
  ResetPasswordPage,
} from "./ResetPasswordPage";

vi.mock("@/lib/auth-client", () => ({
  authClient: { resetPassword: vi.fn() },
}));

function renderAt(search: string) {
  return renderRoutes(
    [{ path: ROUTE.resetPassword.path, element: <ResetPasswordPage /> }],
    { initialEntries: [`${ROUTE.resetPassword.path}${search}`] },
  );
}

/**
 * One screen for an invitation and a reset (#492). Better Auth keeps the
 * `invite=1` it was handed when it redirects an expired link here with
 * `error=INVALID_TOKEN`, so the expired screen can name which link it was.
 */
describe("ResetPasswordPage — wording", () => {
  test("asks a returning colleague to choose a new password", () => {
    renderAt("?token=t");

    expect(screen.getByText("Choose a new password")).toBeInTheDocument();
    expect(
      screen.getByText("Choose a new password for your account."),
    ).toBeInTheDocument();
  });

  test("welcomes an invited colleague with the same verb", () => {
    renderAt("?token=t&invite=1");

    expect(screen.getByText("Welcome — choose a password")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Your account is ready. Choose a password and you are in.",
      ),
    ).toBeInTheDocument();
  });

  test("calls an expired reset link a reset link", () => {
    renderAt("?error=INVALID_TOKEN");

    expect(screen.getByText("That link has expired")).toBeInTheDocument();
    expect(
      screen.getByText(/^Reset links are good for 24 hours/),
    ).toBeInTheDocument();
  });

  test("calls an expired invitation an invitation", () => {
    renderAt("?invite=1&error=INVALID_TOKEN");

    expect(screen.getByText("That link has expired")).toBeInTheDocument();
    expect(
      screen.getByText(/^Invitation links are good for 24 hours/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Reset links/)).not.toBeInTheDocument();
  });
});

/**
 * Which sentence a refused submit gets. Only a refusal of the token blames the
 * link: an unreachable server or a rate limit says nothing about it, and
 * sending that person to an admin is for nothing (#537), as `LoginPage` holds.
 */
describe("ResetPasswordPage — refusals", () => {
  async function submitRefusedWith(status: number, message: string) {
    vi.mocked(authClient.resetPassword).mockResolvedValue({
      data: null,
      error: { status, message, statusText: "" },
    } as never);
    return submit();
  }

  async function submit() {
    const user = userEvent.setup();
    renderAt("?token=t");

    await user.type(screen.getByLabelText("New password"), "password123");
    await user.type(screen.getByLabelText("Confirm password"), "password123");
    await user.click(screen.getByRole("button", { name: "Set password" }));

    return screen.findByRole("alert");
  }

  // Better Auth words its refusals its own way, not the copy standard's (#502).
  test("answers a refused token with the page's sentence, not Better Auth's", async () => {
    const alert = await submitRefusedWith(400, "Invalid token");

    expect(alert).toHaveTextContent(LINK_REFUSED);
    expect(alert).not.toHaveTextContent("Invalid token");
  });

  test.each([0, 500, 503])(
    "says the desk couldn't be reached on status %i, not that the link is invalid",
    async (status) => {
      const alert = await submitRefusedWith(status, "Internal Server Error");

      expect(alert).toHaveTextContent(AUTH_UNREACHABLE_MESSAGE);
      expect(alert).not.toHaveTextContent(LINK_REFUSED);
    },
  );

  // A server that cannot be reached at all returns no `error`: Better Auth's
  // client rejects with fetch's own TypeError, which a built page, its API
  // blocked, showed as nothing but an unhandled rejection.
  test("says the desk couldn't be reached when the request itself throws", async () => {
    vi.mocked(authClient.resetPassword).mockRejectedValue(
      new TypeError("Failed to fetch"),
    );

    const alert = await submit();

    expect(alert).toHaveTextContent(AUTH_UNREACHABLE_MESSAGE);
    expect(alert).not.toHaveTextContent("Failed to fetch");
  });

  test("says to try again later on a 429, not that the link is invalid", async () => {
    const alert = await submitRefusedWith(429, "Too many requests");

    expect(alert).toHaveTextContent(RESET_RATE_LIMITED);
    expect(alert).not.toHaveTextContent(LINK_REFUSED);
    expect(alert).not.toHaveTextContent("Too many requests");
  });
});
