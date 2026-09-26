import type { PgBoss } from "pg-boss";
import { prisma } from "../db";
import { isDemoModeEnabled } from "../demo/mode";
import { seedShowcase } from "../demo/showcase";
import { registerSweep, type SweepSpec } from "./boss";

/**
 * The nightly reset (#323, PRD R6): every night the showcase is put back, so
 * the next visitor finds the desk the seed made rather than the one the last
 * visitor left.
 *
 * Two things:
 *
 * **The demo tickets go back to their seeded state** — `seedShowcase`'s reset
 * mode, the same code `db:seed:tickets --reset` runs, so the night and the
 * command cannot disagree about what "seeded" means. Rows are matched on
 * subject plus customer email, so a ticket that arrived through the webhook or
 * the `/pipeline` simulator is not touched. Every seeded ticket is re-created
 * under a colleague, so none is left filed under a visitor — including one a
 * visitor still here had taken. Eval runs and results live in tables this
 * never names (R15).
 *
 * **Demo identities whose sessions have ended are deleted**, sessions with
 * them (they cascade). One with a live session is kept until the next night,
 * so a visitor mid-demo is not signed out from under themselves; anything they
 * authored or were named on is `SetNull` when it does go.
 *
 * **Only while demo mode is on.** The switch is what says this deployment is a
 * showcase (ADR-0022): the day real customer mail arrives it goes off, and a
 * reset that ran regardless would write a hundred demo tickets into a real
 * desk every night. Read per run, like every other reader of the switch.
 *
 * No realtime event is published. A list open across midnight still shows the
 * rows it last fetched until it refetches; the tickets under them are new rows
 * with new ids, and the banner saying data resets nightly is plan slice 6.
 */
export async function resetDemo(now = Date.now()): Promise<void> {
  if (!isDemoModeEnabled()) return;

  const tickets = await seedShowcase({ reset: true, now });

  const identities = await prisma.user.deleteMany({
    where: {
      isAnonymous: true,
      sessions: { none: { expiresAt: { gt: new Date(now) } } },
    },
  });

  console.log(
    `[demo-reset] Reset ${tickets.created} demo ticket(s); removed ${identities.count} ended demo identit${identities.count === 1 ? "y" : "ies"}.`,
  );
}

const DEMO_RESET_QUEUE = "demo-reset";

/**
 * 00:00 UTC — pg-boss reads a schedule in UTC unless told otherwise — which is
 * when the demo AI budget's day rolls over too (#321), so "resets at 00:00 UTC"
 * is one moment on the banner rather than two.
 */
const DEMO_RESET_CRON = "0 0 * * *";

/**
 * A minute: a reset is a few reads, one transaction of a delete and a hundred
 * inserts, and one delete of identities — seconds, even on a slow day.
 */
const DEMO_RESET_EXPIRE_IN_SECONDS = 60;

export const DEMO_RESET_SWEEP: SweepSpec = {
  name: DEMO_RESET_QUEUE,
  cron: DEMO_RESET_CRON,
  expireInSeconds: DEMO_RESET_EXPIRE_IN_SECONDS,
  run: () => resetDemo(),
};

export async function registerDemoReset(boss: PgBoss): Promise<void> {
  await registerSweep(boss, DEMO_RESET_SWEEP);
}
