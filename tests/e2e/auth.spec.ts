import { test, expect, type Page } from "@playwright/test";
import { CREDENTIALS, signIn } from "./helpers/auth";
import { API_URL } from "./helpers/env";

const ADMIN = CREDENTIALS.admin;
const AGENT = CREDENTIALS.agent;
const WRONG_PASSWORD = "wrongpassword";
const UNKNOWN_EMAIL = "nobody@example.com";
const NEW_USER_EMAIL = "newuser@example.com";
const NEW_USER_NAME = "New User";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fill and submit the login form with the given credentials. */
async function fillLoginForm(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  const emailInput = page.getByLabel("Email");
  const passwordInput = page.getByLabel("Password");

  // Always clear first — DEV mode pre-fills admin creds
  await emailInput.clear();
  await emailInput.fill(email);
  await passwordInput.clear();
  await passwordInput.fill(password);

  await page.getByRole("button", { name: "Sign in" }).click();
}

// ---------------------------------------------------------------------------
// Login flow
// ---------------------------------------------------------------------------

test.describe("Login flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
  });

  test("admin login succeeds — redirects to / and shows Users link", async ({
    page,
  }) => {
    await fillLoginForm(page, ADMIN.email, ADMIN.password);

    await expect(page).toHaveURL("/");
    // Admin sees the Users nav link
    await expect(page.getByRole("link", { name: "Users" })).toBeVisible();
    // Admin name is displayed in the navbar
    await expect(page.getByText("Admin")).toBeVisible();
  });

  test("agent login succeeds — redirects to / and does NOT show Users link", async ({
    page,
  }) => {
    await fillLoginForm(page, AGENT.email, AGENT.password);

    await expect(page).toHaveURL("/");
    // Agent must NOT see the Users nav link
    await expect(page.getByRole("link", { name: "Users" })).not.toBeVisible();
    // Agent name is displayed in the navbar
    await expect(page.getByText("Agent")).toBeVisible();
  });

  test("wrong password — server error shown, stays on /login", async ({
    page,
  }) => {
    await fillLoginForm(page, ADMIN.email, WRONG_PASSWORD);

    await expect(page).toHaveURL("/login");
    // A server-error paragraph with role=alert must appear
    await expect(page.getByRole("alert")).toBeVisible();
    // No session cookie was set — form inputs still present
    await expect(page.getByLabel("Email")).toBeVisible();
  });

  test("unknown email — server error shown, stays on /login", async ({
    page,
  }) => {
    await fillLoginForm(page, UNKNOWN_EMAIL, ADMIN.password);

    await expect(page).toHaveURL("/login");
    await expect(page.getByRole("alert")).toBeVisible();
  });

  test("empty submit — both client-side validation errors appear", async ({
    page,
  }) => {
    // Clear the pre-filled DEV values before submitting
    await page.getByLabel("Email").clear();
    await page.getByLabel("Password").clear();
    await page.getByRole("button", { name: "Sign in" }).click();

    // Zod messages wired via react-hook-form
    await expect(
      page.getByText("Enter a valid email"),
    ).toBeVisible();
    await expect(page.getByText("Password is required")).toBeVisible();
    await expect(page).toHaveURL("/login");
  });

  test("invalid email format — client-side email error appears", async ({
    page,
  }) => {
    await page.getByLabel("Email").clear();
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByLabel("Password").clear();
    await page.getByLabel("Password").fill("anypassword");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText("Enter a valid email")).toBeVisible();
    await expect(page).toHaveURL("/login");
  });

  test("already-authenticated user navigating to /login — bounced to /", async ({
    page,
  }) => {
    // First sign in normally
    await signIn(page, "admin");

    // Now navigate to /login explicitly
    await page.goto("/login");

    // LoginPage detects the existing session and redirects back to /
    await expect(page).toHaveURL("/");
  });

  test("inputs are disabled while submitting", async ({ page }) => {
    // Intercept the sign-in request and stall it long enough to observe
    // the disabled state, then abort so we don't need valid creds here.
    await page.route("**/api/auth/sign-in/email", async (route) => {
      // Delay briefly so the UI has time to disable inputs
      await new Promise<void>((resolve) => setTimeout(resolve, 400));
      await route.abort();
    });

    await page.getByLabel("Email").clear();
    await page.getByLabel("Email").fill(ADMIN.email);
    await page.getByLabel("Password").clear();
    await page.getByLabel("Password").fill(ADMIN.password);

    const submitButton = page.getByRole("button", { name: /Sign in/i });
    void submitButton.click();

    // During the stalled request both inputs and the button must be disabled
    await expect(page.getByLabel("Email")).toBeDisabled();
    await expect(page.getByLabel("Password")).toBeDisabled();
    await expect(page.getByRole("button", { name: /Signing in/i })).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Logout flow
// ---------------------------------------------------------------------------

test.describe("Logout flow", () => {
  test("sign out clears session and redirects to /login", async ({ page }) => {
    await signIn(page, "admin");

    await page.getByRole("button", { name: "Sign out" }).click();

    // Should land on /login
    await expect(page).toHaveURL("/login");

    // Navigating to / now should redirect back to /login (no session)
    await page.goto("/");
    await expect(page).toHaveURL("/login");
  });
});

// ---------------------------------------------------------------------------
// Route protection
// ---------------------------------------------------------------------------

test.describe("Route protection — unauthenticated", () => {
  test("/ redirects to /login when not authenticated", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL("/login");
  });

  test("/users redirects to /login when not authenticated", async ({
    page,
  }) => {
    await page.goto("/users");
    await expect(page).toHaveURL("/login");
  });
});

test.describe("Route protection — authenticated agent", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "agent");
  });

  test("/users redirects agent to / (admin-only route)", async ({ page }) => {
    await page.goto("/users");
    await expect(page).toHaveURL("/");
  });
});

test.describe("Route protection — authenticated admin", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "admin");
  });

  test("/users renders the Users heading for admin", async ({ page }) => {
    await page.goto("/users");
    await expect(page).toHaveURL("/users");
    await expect(
      page.getByRole("heading", { name: "Users" }),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Session persistence
// ---------------------------------------------------------------------------

test.describe("Session persistence", () => {
  test("session survives a full page reload", async ({ page }) => {
    await signIn(page, "admin");

    // Reload the tab — session cookie must keep the user authenticated
    await page.reload();

    await expect(page).toHaveURL("/");
    // The navbar is rendered (not the login form) confirming the session is live
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Sign-up disabled (API-level)
// ---------------------------------------------------------------------------

test.describe("Sign-up disabled", () => {
  test("POST /api/auth/sign-up/email is rejected", async ({ request }) => {
    const response = await request.post(
      `${API_URL}/api/auth/sign-up/email`,
      {
        data: {
          email: NEW_USER_EMAIL,
          password: ADMIN.password,
          name: NEW_USER_NAME,
        },
      },
    );

    // Better Auth rejects sign-up when disableSignUp: true — must not be 2xx
    expect(response.ok()).toBe(false);
  });
});
