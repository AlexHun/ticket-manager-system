import { startBoss, stopBoss } from "./boss";
import { registerClassifyTicket } from "./classify-ticket";

/**
 * Where background work is wired up.
 *
 * One line per consumer, and the reason this file exists rather than letting
 * `./boss` register things itself: the lifecycle should not know what runs on
 * it, and the consumers should not know how it starts. Phase 3's outbound
 * Postmark send is the next entry here.
 *
 * Registration order does not matter — each `register*` creates its own queues
 * and workers — but every one of them must complete before `startJobs` resolves,
 * because `index.ts` only starts listening for HTTP afterwards. A request that
 * enqueued onto a queue nobody was working yet would sit there until the next
 * poll at best, and the reconciliation sweep at worst.
 */
export async function startJobs(): Promise<void> {
  const boss = await startBoss();
  await registerClassifyTicket(boss);
}

export { stopBoss as stopJobs };
