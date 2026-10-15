import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { authClient } from "@/lib/auth-client";
import { ROUTE } from "@/lib/routes";
import { renderRoutes } from "@/test/render";
import { ResetPasswordPage } from "./ResetPasswordPage";

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

  // Better Auth words its refusals its own way, not the copy standard's (#502),
  // as `LoginPage` already holds.
  test("answers a refused submit with the page's sentence, not Better Auth's", async () => {
    vi.mocked(authClient.resetPassword).mockResolvedValue({
      data: null,
      error: { status: 400, message: "Invalid token", statusText: "" },
    } as never);
    const user = userEvent.setup();
    renderAt("?token=t");

    await user.type(screen.getByLabelText("New password"), "password123");
    await user.type(screen.getByLabelText("Confirm password"), "password123");
    await user.click(screen.getByRole("button", { name: "Set password" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "That link is no longer valid. Ask an admin to send you another.",
    );
    expect(alert).not.toHaveTextContent("Invalid token");
  });
});
