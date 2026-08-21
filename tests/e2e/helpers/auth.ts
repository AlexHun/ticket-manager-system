import type { Page } from "@playwright/test";
import type { UserRole } from "@ticket/shared";
import { waitForInvitationLink } from "./db";

export const CREDENTIALS: Record<UserRole, { email: string; password: string }> = {
  admin: { email: "admin@example.com", password: "password123" },
  agent: { email: "agent@example.com", password: "password123" },
};

/**
 * Log in via the login form and wait until the home page is reached.
 * Use this in tests that are NOT about the login UI itself.
 *
 * NOTE: The form is pre-filled with admin creds in DEV mode, so we always
 * clear and re-fill both fields to ensure the right user is signed in.
 */
export async function signIn(page: Page, role: UserRole): Promise<void> {
  const { email, password } = CREDENTIALS[role];

  await page.goto("/login");

  const emailInput = page.getByLabel("Email");
  const passwordInput = page.getByLabel("Password");

  await emailInput.clear();
  await emailInput.fill(email);
  await passwordInput.clear();
  await passwordInput.fill(password);

  await page.getByRole("button", { name: "Sign in" }).click();

  // Wait until the app leaves /login — the route guard will redirect to /
  await page.waitForURL("/");
}

/**
 * Follow an invitation to its end: read the link out of the outbox, choose a
 * password, and land back at the sign-in form ready to use it.
 *
 * **This is the only way an account acquires a password now.** `POST /api/users`
 * creates colleagues without one on purpose, so any test that needs a user it
 * can sign in as has to come through here — there is no longer a field an admin
 * could type into on their behalf.
 *
 * Reaching the form is itself an assertion that the token was good: Better Auth
 * checks it before redirecting, and a bad or expired one arrives at
 * `?error=INVALID_TOKEN`, where `ResetPasswordPage` renders no fields at all.
 */
export async function acceptInvitation(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  const link = await waitForInvitationLink(email);

  // Absolute, and pointing at the API rather than the web app — the link is
  // consumed by `/api/auth/reset-password/:token`, which redirects to the page.
  await page.goto(link);

  await page.getByLabel("New password").fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Set password" }).click();

  await page.waitForURL("/login");
}
