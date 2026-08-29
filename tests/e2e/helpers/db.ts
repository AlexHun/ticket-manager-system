import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../apps/api/src/generated/prisma/client";
import { OUTBOUND_EMAIL_KIND } from "@ticket/shared";
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

/**
 * Delete the outbox rows the suite caused.
 *
 * `OutboundEmail` carries no foreign key to `User` — deliberately, so the send
 * worker knows nothing about who an email is for — which means sweeping the e2e
 * users leaves their invitations sitting in the table, each holding a link that
 * still works until it expires.
 */
export async function resetE2eEmails(): Promise<number> {
  const { count } = await testDb.outboundEmail.deleteMany({
    where: { toEmail: { startsWith: E2E_EMAIL_PREFIX } },
  });
  return count;
}

/**
 * Delete a user's saved dashboard layout (issue #102), reverting them to
 * `DEFAULT_DASHBOARD_LAYOUT` the same way `DELETE /api/dashboard-layout`
 * does. Used to give a test a known-clean starting point regardless of what
 * an earlier test (or an earlier run that died mid-test) left behind — the
 * seeded admin/agent are shared across the whole suite, unlike the
 * `e2e-`-prefixed throwaway users, so their layout rows can't be swept by
 * `resetE2eUsers`.
 */
export async function resetDashboardLayout(email: string): Promise<void> {
  await testDb.dashboardLayout.deleteMany({ where: { user: { email } } });
}

/**
 * The link out of the newest invitation written to `email`.
 *
 * With no mail provider bound, the outbox *is* the inbox: `jobs/send-email.ts`
 * marks these rows `undeliverable` and an admin reads the link off `/outbox`.
 * This does the same thing one layer down — the row carries the body either
 * way, and reading it from Postgres does not depend on that page's polling.
 *
 * Polled rather than read once, because `POST /api/users` answers 201 before
 * the invitation exists. `sendResetPassword` is deliberately not awaited (the
 * time it takes is otherwise a signal about whether an address exists), so the
 * row lands a moment after the response the caller was waiting on.
 */
export async function waitForInvitationLink(
  email: string,
  timeoutMs = 10_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const row = await testDb.outboundEmail.findFirst({
      where: { toEmail: email, kind: OUTBOUND_EMAIL_KIND.invitation },
      orderBy: { id: "desc" },
      select: { textBody: true },
    });

    const link = row?.textBody.match(/https?:\/\/\S+/)?.[0];
    if (link) return link;

    if (Date.now() > deadline) {
      throw new Error(
        `No invitation reached the outbox for ${email} within ${timeoutMs}ms. ` +
          `Expected POST /api/users to enqueue one.`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
