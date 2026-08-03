import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../apps/api/src/generated/prisma/client";
import { DATABASE_URL } from "./env";

/** Prisma client pointed at the test DB. `log: []` keeps test output readable. */
export const testDb = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
  log: [],
});

/** Delete every ticket; messages cascade via the FK on Message.ticketId. */
export async function resetTickets(): Promise<void> {
  await testDb.ticket.deleteMany();
}

/**
 * Every email the suite creates starts with this prefix. The seeded
 * `admin@example.com` / `agent@example.com` deliberately do not match it, so
 * the sweep below can never remove the accounts the tests sign in with.
 */
export const E2E_EMAIL_PREFIX = "e2e-";

/**
 * Hard-delete the users the suite created.
 *
 * `DELETE /api/users/:id` is a soft delete — it sets `deletedAt` and hides the
 * row from `GET /api/users` but leaves it in the table. Tests that create a
 * user therefore leak a row on every run even when they clean up through the
 * UI, and the ones that never delete leak an active row.
 *
 * Sessions and accounts cascade via their FKs; any ticket assigned to one of
 * these users has `assignedToId` set to null rather than being deleted.
 */
export async function resetE2eUsers(): Promise<number> {
  const { count } = await testDb.user.deleteMany({
    where: { email: { startsWith: E2E_EMAIL_PREFIX } },
  });
  return count;
}
