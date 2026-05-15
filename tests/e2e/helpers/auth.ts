import type { Page } from "@playwright/test";

export type UserRole = "admin" | "agent";

const CREDENTIALS: Record<UserRole, { email: string; password: string }> = {
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
