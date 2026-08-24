import { isAiConfigured } from "../ai/provider";
import { registerAutoReplyTicket } from "./auto-reply-ticket";
import { startBoss, stopBoss } from "./boss";
import { registerClassifyTicket } from "./classify-ticket";
import { registerPruneOutbox } from "./prune-outbox";
import { registerSendEmail } from "./send-email";

/**
 * Where background work is wired up.
 *
 * One line per consumer, and the reason this file exists rather than letting
 * `./boss` register things itself: the lifecycle should not know what runs on
 * it, and the consumers should not know how it starts. The outbox retention
 * sweep was the fourth entry; a fifth goes on the same list.
 *
 * Registration order does not matter — each `register*` creates its own queues
 * and workers — but every one of them must complete before `startJobs` resolves,
 * because `index.ts` only starts listening for HTTP afterwards. A request that
 * enqueued onto a queue nobody was working yet would sit there until the next
 * poll at best, and the reconciliation sweep at worst.
 *
 * The classifier and the auto-reply are gated on `isAiConfigured()` and the
 * other two are not, because that is exactly the line their own enqueue
 * functions already draw: `enqueueClassification`/`enqueueAutoReply` are no-ops
 * without a key (see `classify-ticket.ts`, `auto-reply-ticket.ts`), so a
 * keyless deployment's workers for these two queues were pure overhead —
 * attached to `classify-ticket`/`auto-reply-ticket` in the shared Postgres
 * `pgboss` schema and doing nothing but poll. That stopped being merely wasted
 * the day a second, AI-enabled process could point at the same database: an
 * idle-but-registered worker on the keyless process can still pick up a job the
 * other process enqueued and fail it for want of a key. `send-email` and
 * `prune-outbox` have no such split — every deployment runs them.
 */
export async function startJobs(): Promise<void> {
  const boss = await startBoss();
  if (isAiConfigured()) {
    await registerClassifyTicket(boss);
    await registerAutoReplyTicket(boss);
  }
  await registerSendEmail(boss);
  await registerPruneOutbox(boss);
}

export { stopBoss as stopJobs };
