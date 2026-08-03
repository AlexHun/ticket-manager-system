import { test, expect } from "@playwright/test";
import { CREDENTIALS, signIn } from "./helpers/auth";
import { resetE2eUsers } from "./helpers/db";

const ADMIN = CREDENTIALS.admin;
const AGENT = CREDENTIALS.agent;

// Every test below creates users through the UI, and the API's delete is a
// soft delete — so without this the rows survive the run and pile up in the
// test DB. global-setup sweeps too, covering runs that die before this hook.
test.afterAll(async () => {
  await resetE2eUsers();
});

// Unique per test run so parallel/repeated runs never collide on email.
const NEW_USER_EMAIL = `e2e-user-${Date.now()}@example.com`;
const NEW_USER_NAME = "E2E Created User";
const RENAMED_USER_NAME = "E2E Renamed User";
const NEW_USER_PASSWORD = "password123";

// Tests run in order and share the user created in "create a new user" —
// serial so create/edit/delete each build on the previous test's state.
test.describe.serial("User management (admin)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "admin");
    await page.goto("/users");
    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
  });

  test("lists the seeded admin and agent users with correct role badges", async ({
    page,
  }) => {
    const adminRow = page.getByRole("row", { name: ADMIN.email });
    await expect(adminRow).toBeVisible();
    await expect(adminRow.getByText("Admin", { exact: true })).toBeVisible();
    await expect(adminRow.getByText("admin", { exact: true })).toBeVisible();

    const agentRow = page.getByRole("row", { name: AGENT.email });
    await expect(agentRow).toBeVisible();
    await expect(agentRow.getByText("Agent", { exact: true })).toBeVisible();
    await expect(agentRow.getByText("agent", { exact: true })).toBeVisible();
  });

  test("creates a new user", async ({ page }) => {
    await page.getByRole("button", { name: "New user" }).click();

    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Create user" }),
    ).toBeVisible();

    await dialog.getByLabel("Name").fill(NEW_USER_NAME);
    await dialog.getByLabel("Email").fill(NEW_USER_EMAIL);
    await dialog.getByLabel("Password").fill(NEW_USER_PASSWORD);

    await dialog.getByRole("button", { name: "Create user" }).click();

    await expect(dialog).toBeHidden();

    const newRow = page.getByRole("row", { name: NEW_USER_EMAIL });
    await expect(newRow).toBeVisible();
    await expect(newRow.getByText(NEW_USER_NAME)).toBeVisible();
    await expect(newRow.getByText("agent", { exact: true })).toBeVisible();
  });

  test("edits the created user", async ({ page }) => {
    const row = page.getByRole("row", { name: NEW_USER_EMAIL });
    await row.getByRole("button", { name: `Edit ${NEW_USER_NAME}` }).click();

    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Edit user" }),
    ).toBeVisible();

    const nameInput = dialog.getByLabel("Name");
    await expect(nameInput).toHaveValue(NEW_USER_NAME);
    await nameInput.clear();
    await nameInput.fill(RENAMED_USER_NAME);

    await expect(
      dialog.getByPlaceholder("Leave blank to keep current password"),
    ).toBeVisible();

    await dialog.getByRole("button", { name: "Save changes" }).click();

    await expect(dialog).toBeHidden();

    const updatedRow = page.getByRole("row", { name: NEW_USER_EMAIL });
    await expect(updatedRow.getByText(RENAMED_USER_NAME)).toBeVisible();
  });

  test("deletes the created user", async ({ page }) => {
    const row = page.getByRole("row", { name: NEW_USER_EMAIL });
    await row
      .getByRole("button", { name: `Delete ${RENAMED_USER_NAME}` })
      .click();

    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Delete user" }),
    ).toBeVisible();

    await dialog.getByRole("button", { name: "Delete user" }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByRole("row", { name: NEW_USER_EMAIL })).toHaveCount(
      0,
    );
  });
});

// ---------------------------------------------------------------------------
// Admin row protections — admin rows can never be deleted from the UI
// ---------------------------------------------------------------------------

test.describe("Admin row protections", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "admin");
    await page.goto("/users");
    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
  });

  test("admin row has no delete button but does have an edit button", async ({
    page,
  }) => {
    const adminRow = page.getByRole("row", { name: ADMIN.email });
    await expect(adminRow).toBeVisible();

    // Delete is hidden entirely for admin rows (UsersTable renders a
    // placeholder span instead of a button for role === "admin").
    await expect(
      adminRow.getByRole("button", { name: /Delete/ }),
    ).toHaveCount(0);

    // Edit is still present, proving the row rendered normally.
    await expect(
      adminRow.getByRole("button", { name: /Edit/ }),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Delete + create lifecycle proofs — each test creates its own throwaway
// user so they don't depend on (or interfere with) the serial CRUD block.
// ---------------------------------------------------------------------------

test.describe("User lifecycle — sign-in consequences", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "admin");
    await page.goto("/users");
    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
  });

  test("a deleted user cannot sign in afterward", async ({ page }) => {
    const email = `e2e-deleted-${Date.now()}@example.com`;
    const name = "E2E Deleted User";
    const password = "password123";

    // Create the throwaway agent via the UI.
    await page.getByRole("button", { name: "New user" }).click();
    const createDialog = page.getByRole("dialog");
    await createDialog.getByLabel("Name").fill(name);
    await createDialog.getByLabel("Email").fill(email);
    await createDialog.getByLabel("Password").fill(password);
    await createDialog.getByRole("button", { name: "Create user" }).click();
    await expect(createDialog).toBeHidden();

    const row = page.getByRole("row", { name: email });
    await expect(row).toBeVisible();

    // Delete them via the UI.
    await row.getByRole("button", { name: `Delete ${name}` }).click();
    const deleteDialog = page.getByRole("dialog");
    await expect(
      deleteDialog.getByRole("heading", { name: "Delete user" }),
    ).toBeVisible();
    await deleteDialog.getByRole("button", { name: "Delete user" }).click();
    await expect(deleteDialog).toBeHidden();
    await expect(page.getByRole("row", { name: email })).toHaveCount(0);

    // Sign out as admin.
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL("/login");

    // The deleted user's credentials must now fail — soft-delete sets
    // banned: true and wipes sessions server-side.
    await page.getByLabel("Email").clear();
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").clear();
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL("/login");
    await expect(page.getByRole("alert")).toBeVisible();
  });

  test("a newly-created user can sign in with their own password", async ({
    page,
  }) => {
    const email = `e2e-newlogin-${Date.now()}@example.com`;
    const name = "E2E New Login User";
    const password = "password123";

    await page.getByRole("button", { name: "New user" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill(name);
    await dialog.getByLabel("Email").fill(email);
    await dialog.getByLabel("Password").fill(password);
    await dialog.getByRole("button", { name: "Create user" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("row", { name: email })).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL("/login");

    await page.getByLabel("Email").clear();
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").clear();
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL("/");
    // Fresh user was created as an agent (default role) — no Users link.
    await expect(page.getByRole("link", { name: "Users" })).not.toBeVisible();
  });
});
