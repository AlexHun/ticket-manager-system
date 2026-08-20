import { test, expect, type Browser } from "@playwright/test";
import { CREDENTIALS, signIn } from "./helpers/auth";
import { API_URL } from "./helpers/env";

// Direct API-level RBAC tests — no browser UI flow. These prove the server
// enforces requireAdmin on every /api/users route (defense in depth beyond
// the frontend hiding admin-only UI), independent of anything auth.spec.ts
// or user-management.spec.ts already covers via the UI.

const ADMIN = CREDENTIALS.admin;
const AGENT = CREDENTIALS.agent;

interface ApiUser {
  id: string;
  email: string;
}

async function getUserIds(browser: Browser): Promise<{ adminId: string; agentId: string }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, "admin");

  const res = await page.request.get(`${API_URL}/api/users`);
  const body = (await res.json()) as { users: ApiUser[] };

  const admin = body.users.find((u) => u.email === ADMIN.email);
  const agent = body.users.find((u) => u.email === AGENT.email);
  if (!admin || !agent) {
    throw new Error("Seeded admin/agent user not found via GET /api/users");
  }

  await context.close();
  return { adminId: admin.id, agentId: agent.id };
}

let adminUserId: string;
let agentUserId: string;

test.beforeAll(async ({ browser }) => {
  ({ adminId: adminUserId, agentId: agentUserId } = await getUserIds(browser));
});

// ---------------------------------------------------------------------------
// Unauthenticated — Better Auth's session check runs first (requireAdmin
// checks `session` before role), so every route must 401, not 403.
// ---------------------------------------------------------------------------

test.describe("Users API — unauthenticated", () => {
  test("GET /api/users -> 401", async ({ request }) => {
    const res = await request.get(`${API_URL}/api/users`);
    expect(res.status()).toBe(401);
  });

  test("POST /api/users -> 401", async ({ request }) => {
    const res = await request.post(`${API_URL}/api/users`, {
      data: {
        name: "Nobody",
        email: `e2e-unauth-${Date.now()}@example.com`,
      },
    });
    expect(res.status()).toBe(401);
  });

  test("PATCH /api/users/:id -> 401", async ({ request }) => {
    const res = await request.patch(`${API_URL}/api/users/does-not-matter`, {
      data: { name: "Nobody", email: "nobody@example.com" },
    });
    expect(res.status()).toBe(401);
  });

  test("DELETE /api/users/:id -> 401", async ({ request }) => {
    const res = await request.delete(`${API_URL}/api/users/does-not-matter`);
    expect(res.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Agent session — authenticated but not admin, so requireAdmin must 403.
// PATCH/DELETE target the agent's OWN id, proving the block is role-based
// and not just "that id doesn't exist".
// ---------------------------------------------------------------------------

test.describe("Users API — agent session (forbidden)", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "agent");
  });

  test("GET /api/users -> 403", async ({ page }) => {
    const res = await page.request.get(`${API_URL}/api/users`);
    expect(res.status()).toBe(403);
  });

  test("POST /api/users -> 403", async ({ page }) => {
    const res = await page.request.post(`${API_URL}/api/users`, {
      data: {
        name: "Nobody",
        email: `e2e-agent-forbidden-${Date.now()}@example.com`,
      },
    });
    expect(res.status()).toBe(403);
  });

  test("PATCH /api/users/:id (own id) -> 403", async ({ page }) => {
    const res = await page.request.patch(`${API_URL}/api/users/${agentUserId}`, {
      data: { name: "Agent User", email: AGENT.email },
    });
    expect(res.status()).toBe(403);
  });

  test("DELETE /api/users/:id (own id) -> 403", async ({ page }) => {
    const res = await page.request.delete(`${API_URL}/api/users/${agentUserId}`);
    expect(res.status()).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Server-side admin-delete guard — defense in depth beyond the UI hiding
// the delete button for admin rows.
// ---------------------------------------------------------------------------

test.describe("Users API — admin-delete guard", () => {
  test("DELETE /api/users/:id on an admin user -> 403 with explicit message", async ({
    page,
  }) => {
    await signIn(page, "admin");

    const res = await page.request.delete(`${API_URL}/api/users/${adminUserId}`);
    expect(res.status()).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "Admin users cannot be deleted",
    });
  });
});
