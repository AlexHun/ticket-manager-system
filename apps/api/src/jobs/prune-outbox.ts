import type { PgBoss } from "pg-boss";
import {
  OUTBOUND_EMAIL_KIND,
  OUTBOUND_EMAIL_STATUS,
  type OutboundEmailKind,
  type OutboundEmailStatus,
} from "@ticket/shared";
import { RESET_TOKEN_TTL_SECONDS } from "../auth";
import { prisma } from "../db";
import { registerSweep, type SweepSpec } from "./boss";

/**
 * Throwing away outbox rows that have stopped being worth keeping.
 *
 * The outbox was built to grow — every email this desk means to send becomes a
 * row, and nothing has ever removed one. That is fine for the delivery
 * machinery and wrong for two other reasons, which are the reasons this file
 * exists:
 *
 * **The rows hold live credentials.** An invitation or password-reset body *is*
 * a working single-use link for somebody else's account. `GET /api/outbox` is
 * admin-only precisely because of that, but an admin-only pile of every reset
 * link ever minted is still a pile of reset links, and it grows for as long as
 * the deployment runs. The link stops working after
 * `RESET_TOKEN_TTL_SECONDS`; the row holding it should not outlive it.
 *
 * **The bodies are already stored elsewhere.** A reply row duplicates
 * `Message.textBody`, which is the copy an agent reads in the thread and the
 * one that is never pruned. What the outbox row adds — `sentAt`, `attempts`,
 * `providerMessageId`, the reason it failed — is a delivery log, and a delivery
 * log is worth keeping for a season rather than forever.
 *
 * **Deletion, not redaction.** Blanking `textBody` and keeping the row was the
 * other candidate and it is worse: `POST /api/outbox/:id/retry` sends whatever
 * is in that column, so a redacted row is one click away from emailing somebody
 * a placeholder. A row that is gone cannot be retried at all, which is the
 * honest state — see the note on `AUTH_MAIL_RETENTION_MS`.
 */

/**
 * What may be deleted, and what may never be.
 *
 * `queued` is absent and that absence is the safety property: a queued row has
 * a job coming for it, and deleting one would silently drop an email the app
 * has already promised to send. The three here are the states the worker
 * settles a row into, so nothing is scheduled to touch them again.
 *
 * Listed rather than expressed as "not queued" so that a fifth status has to be
 * classified by hand instead of being swept up by a negation nobody re-read.
 */
const PRUNABLE_STATUS: readonly OutboundEmailStatus[] = [
  OUTBOUND_EMAIL_STATUS.sent,
  OUTBOUND_EMAIL_STATUS.failed,
  OUTBOUND_EMAIL_STATUS.undeliverable,
];

/**
 * How long an invitation or reset row is kept: exactly as long as the link in
 * it works.
 *
 * Read from `auth.ts` rather than restated, so raising the token's life raises
 * this with it. The coupling is the argument: the entire body of one of these
 * rows is a link, so the moment the token expires the row holds nothing anyone
 * can use and everything an attacker would like.
 *
 * **Nothing is lost by deleting these, because the recovery path already
 * exists.** With no mail provider bound this screen is how an invitation
 * reaches a new colleague — but if it has sat unread for a day the link is dead
 * anyway, and the fix is the same either way: press Resend on the roster
 * (`POST /api/users/:id/invite`), which mints a fresh token and writes a fresh
 * row. Keeping the expired one only offers an admin a link that will fail.
 */
const AUTH_MAIL_RETENTION_MS = RESET_TOKEN_TTL_SECONDS * 1_000;

/**
 * How long a ticket reply is kept: ninety days.
 *
 * Long enough that "did we ever answer this, and did it go out?" is still
 * answerable for anything anybody is likely to ask about, and long enough to
 * cover a provider outage nobody noticed at the time. The reply itself is not
 * at stake — `Message.textBody` holds it and is never pruned — so what expires
 * here is the delivery record, not the correspondence.
 *
 * It does mean a reply still sitting `undeliverable` at ninety days becomes
 * unsendable. That is deliberate: an answer to a customer's question arriving a
 * quarter of a year late is worse than one that never arrives, and a backlog
 * that old is a deployment problem rather than a queue to drain.
 */
const REPLY_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;

/**
 * A `Record`, for the reason every other one in `src/jobs` is: a fourth
 * `OutboundEmailKind` is a compile error here until somebody says how long it
 * is kept. The alternative — a default with a lookup — is how a new kind of
 * mail quietly inherits ninety days for a body that should have gone in a day.
 */
const RETENTION_MS: Record<OutboundEmailKind, number> = {
  [OUTBOUND_EMAIL_KIND.reply]: REPLY_RETENTION_MS,
  [OUTBOUND_EMAIL_KIND.passwordReset]: AUTH_MAIL_RETENTION_MS,
  [OUTBOUND_EMAIL_KIND.invitation]: AUTH_MAIL_RETENTION_MS,
};

const PRUNE_QUEUE = "prune-outbox";

/**
 * Hourly, on a minute nobody else uses.
 *
 * Not daily: the auth rows are the point, and a daily sweep would leave a dead
 * reset link readable for up to a further twenty-four hours — doubling the
 * window this exists to close. Hourly costs one indexed query per kind per
 * hour, which is nothing, and bounds the overshoot to an hour.
 */
const PRUNE_CRON = "23 * * * *";

/**
 * Rows deleted per statement, and how many statements one sweep may run.
 *
 * Batched because the first sweep on a long-running deployment is the big one —
 * everything ever written that is past its window goes at once — and a single
 * unbounded `DELETE` there would hold locks for as long as it took. Capping the
 * sweep rather than looping until empty is the same trade `recoverStuck` makes:
 * whatever is left is still there in an hour, and a job that cannot run long is
 * a job that cannot block a deploy.
 */
const BATCH_SIZE = 500;
const MAX_BATCHES = 20;

/**
 * How long one sweep may run before pg-boss assumes the process died.
 *
 * Five minutes, against a worst case of three kinds × twenty batches of five
 * hundred — the first sweep on a deployment that has never had one. Longer than
 * the workers' expiry rather than shorter, which is the opposite of what the
 * cadence suggests: a worker is waiting on one provider call, this is waiting on
 * up to sixty indexed statements.
 */
const EXPIRE_IN_SECONDS = 300;

/** Delete the expired rows of one kind. Returns how many went. */
async function pruneKind(
  kind: OutboundEmailKind,
  now: number,
): Promise<number> {
  const cutoff = new Date(now - RETENTION_MS[kind]);
  let removed = 0;

  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    // Select-then-delete rather than one `deleteMany`, because `deleteMany` has
    // no `take` and the batching above is the whole point. The `[status,
    // createdAt]` index already on the table carries this; `kind` is a
    // three-value filter applied after it and does not earn one of its own.
    const doomed = await prisma.outboundEmail.findMany({
      where: {
        kind,
        status: { in: [...PRUNABLE_STATUS] },
        createdAt: { lt: cutoff },
      },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: BATCH_SIZE,
    });

    if (doomed.length === 0) break;

    // Re-stating the status in the `where` and not only the ids: a row can have
    // been retried into `queued` by an admin between the select above and this
    // delete, and deleting it then would drop an email with a job already on its
    // way to fetch it.
    const { count } = await prisma.outboundEmail.deleteMany({
      where: {
        id: { in: doomed.map((row) => row.id) },
        status: { in: [...PRUNABLE_STATUS] },
      },
    });
    removed += count;

    if (doomed.length < BATCH_SIZE) break;
  }

  return removed;
}

/** One sweep across every kind. */
export async function pruneOutbox(): Promise<void> {
  const now = Date.now();
  const counts: string[] = [];
  let total = 0;

  for (const kind of Object.values(OUTBOUND_EMAIL_KIND)) {
    const removed = await pruneKind(kind, now);
    if (removed > 0) {
      counts.push(`${kind}=${removed}`);
      total += removed;
    }
  }

  // Silent when there is nothing to do, which is most hours. A sweep that logs
  // "0 rows" twenty-four times a day is a line everybody filters out, including
  // on the day it says something else.
  if (total > 0) {
    console.log(`[outbox] pruned ${total} row(s): ${counts.join(" ")}`);
  }
}

/**
 * What `./boss` needs to run this sweep, and how `pruneOutbox` is reached
 * without a queue backend — which is the half worth having a handle on: what
 * this deletes is irreversible, and the row it must never touch (`queued`, with
 * a job already on its way to fetch it) is invisible in production until the
 * day an email silently does not arrive.
 */
export const PRUNE_OUTBOX_SWEEP: SweepSpec = {
  name: PRUNE_QUEUE,
  cron: PRUNE_CRON,
  expireInSeconds: EXPIRE_IN_SECONDS,
  run: pruneOutbox,
};

/** Create the queue and start the sweep. Called once, from `./index`. */
export async function registerPruneOutbox(boss: PgBoss): Promise<void> {
  await registerSweep(boss, PRUNE_OUTBOX_SWEEP);
}
