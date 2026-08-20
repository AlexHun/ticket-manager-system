import { test, expect } from "@playwright/test";
import { acceptInvitation, CREDENTIALS, signIn } from "./helpers/auth";
import { resetE2eEmails, resetE2eUsers } from "./helpers/db";

const ADMIN = CREDENTIALS.admin;
const AGENT = CREDENTIALS.agent;

// Every test below creates users through the UI, and the API's delete is a
// soft delete — so without this the rows survive the run and pile up in the
// test DB. Their invitations outlive them too, since the outbox carries no FK
// to User. global-setup sweeps both, covering runs that die before this hook.
test.afterAll(async () => {
  await resetE2eUsers();
  await resetE2eEmails();
});

// Unique per test run so parallel/repeated runs never collide on email.
const NEW_USER_EMAIL = `e2e-user-${Date.now()}@example.com`;
const NEW_USER_NAME = "E2E Created User";
const RENAMED_USER_NAME = "E2E Renamed User";

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

  test("creates a new user without setting a password", async ({ page }) => {
    await page.getByRole("button", { name: "New user" }).click();

    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Create user" }),
    ).toBeVisible();

    await dialog.getByLabel("Name").fill(NEW_USER_NAME);
    await dialog.getByLabel("Email").fill(NEW_USER_EMAIL);

    // There is nowhere to type one. An admin able to set a colleague's password
    // is a person other than its owner who knows it, which is the whole thing
    // this form gave up — see
    // docs/adr/0011-nobody-types-somebody-elses-password.md.
    await expect(dialog.getByLabel("Password")).toHaveCount(0);

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

    // This form used to carry an optional password field ("Leave blank to keep
    // current password"), and it was the sharper of the two: `setUserPassword`
    // creates a credential row where none existed, which is how an admin could
    // once have made the assistant signable-in through an ordinary edit.
    await expect(dialog.getByLabel("Password")).toHaveCount(0);

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
    await createDialog.getByRole("button", { name: "Create user" }).click();
    await expect(createDialog).toBeHidden();

    await expect(page.getByRole("row", { name: email })).toBeVisible();

    // Give them working credentials first, or this test proves nothing: an
    // account created today has no password at all, so the sign-in at the end
    // would fail whether or not the delete did anything. Accepting an
    // invitation signs nobody in, so the admin session survives it.
    await acceptInvitation(page, email, password);

    await page.goto("/users");
    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();

    // Delete them via the UI.
    const row = page.getByRole("row", { name: email });
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

  test("an invited user chooses their own password and signs in as an agent", async ({
    page,
  }) => {
    const email = `e2e-newlogin-${Date.now()}@example.com`;
    const name = "E2E New Login User";
    const password = "password123";

    await page.getByRole("button", { name: "New user" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill(name);
    await dialog.getByLabel("Email").fill(email);
    await dialog.getByRole("button", { name: "Create user" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("row", { name: email })).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL("/login");

    // The path a new colleague actually walks: an invitation lands in the
    // outbox, they follow its link and pick a password nobody else has seen.
    await acceptInvitation(page, email, password);

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
