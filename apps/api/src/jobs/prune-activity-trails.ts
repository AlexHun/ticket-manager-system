import type { PgBoss } from "pg-boss";
import { prisma } from "../db";

/**
 * Throwing away audit-trail rows old enough that nothing needs them any more.
 *
 * `TicketActivity`, `AdminActivity`, `AutomationSettingsRevision` and
 * `KnowledgeArticleRevision` were all built to grow forever, and until now
 * nothing removed a row. `docs/adr/0012` is the decision behind this file: one
 * year, uniformly, for storage hygiene rather than any compliance mandate — see
 * that ADR before changing the window or adding a fifth table.
 */

/**
 * One retention window for all four tables, not a `Record` per table the way
 * `prune-outbox.ts` keys `RETENTION_MS` by kind. The outbox earns that
 * because its rows are genuinely different things (a live credential versus a
 * delivery log for correspondence stored elsewhere); these four tables are
 * the same thing four times — a log of who changed what, and when — so one
 * constant says that honestly instead of typing the same number four times.
 */
const RETENTION_MS = 365 * 24 * 60 * 60 * 1_000;

const PRUNE_QUEUE = "prune-activity-trails";

/**
 * Daily, not hourly like `prune-outbox.ts`. Nothing here holds a live
 * credential with a short fuse — the outbox's hourly cadence exists to bound
 * how long a dead reset link stays readable, and a year-long window has no
 * equivalent urgency. A different minute from every other schedule in
 * `src/jobs/` so cron logs stay easy to tell apart.
 */
const PRUNE_CRON = "41 3 * * *";

/**
 * Rows deleted per statement, and how many statements one sweep may run. Same
 * numbers and same reasoning as `prune-outbox.ts`: the first sweep on a
 * year-old deployment is the big one, and an unbounded `DELETE` would hold
 * locks for as long as it took.
 */
const BATCH_SIZE = 500;
const MAX_BATCHES = 20;

/**
 * Select-then-delete in batches, generalized over a model's `findMany` /
 * `deleteMany`. Re-stated as a `where` on the delete rather than trusting the
 * ids alone for the same reason `prune-outbox.ts` does it: nothing here can
 * change out from under the sweep between the two calls today, but restating
 * the predicate costs nothing and keeps that true if one ever does.
 */
async function batchedDelete(
  findBatch: (take: number) => Promise<{ id: number }[]>,
  deleteBatch: (ids: number[]) => Promise<number>,
): Promise<number> {
  let removed = 0;

  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const doomed = await findBatch(BATCH_SIZE);
    if (doomed.length === 0) break;

    removed += await deleteBatch(doomed.map((row) => row.id));
    if (doomed.length < BATCH_SIZE) break;
  }

  return removed;
}

async function pruneTicketActivity(cutoff: Date): Promise<number> {
  return batchedDelete(
    (take) =>
      prisma.ticketActivity.findMany({
        where: { createdAt: { lt: cutoff } },
        select: { id: true },
        orderBy: { createdAt: "asc" },
        take,
      }),
    async (ids) => {
      const { count } = await prisma.ticketActivity.deleteMany({
        where: { id: { in: ids } },
      });
      return count;
    },
  );
}

async function pruneAdminActivity(cutoff: Date): Promise<number> {
  return batchedDelete(
    (take) =>
      prisma.adminActivity.findMany({
        where: { createdAt: { lt: cutoff } },
        select: { id: true },
        orderBy: { createdAt: "asc" },
        take,
      }),
    async (ids) => {
      const { count } = await prisma.adminActivity.deleteMany({
        where: { id: { in: ids } },
      });
      return count;
    },
  );
}

async function pruneAutomationSettingsRevision(cutoff: Date): Promise<number> {
  return batchedDelete(
    (take) =>
      prisma.automationSettingsRevision.findMany({
        where: { createdAt: { lt: cutoff } },
        select: { id: true },
        orderBy: { createdAt: "asc" },
        take,
      }),
    async (ids) => {
      const { count } = await prisma.automationSettingsRevision.deleteMany({
        where: { id: { in: ids } },
      });
      return count;
    },
  );
}

/**
 * The one revision id per article that must survive regardless of age.
 *
 * `docs/adr/0006` made articles undeletable through the ORM by construction —
 * `KnowledgeArticleRevision.article` is `onDelete: Restrict`, so a
 * `KnowledgeArticle` stays deletable only for as long as *no* revision names
 * it. A blind sweep on an article that has not been edited in over a year
 * would delete its only revision and silently reopen that hole. `id` rather
 * than `createdAt` for "most recent" because ids are assigned in insertion
 * order by the same `autoincrement()` and a `groupBy` `_max` is one indexed
 * aggregate instead of a per-article `ORDER BY … LIMIT 1`.
 */
async function latestRevisionIdPerArticle(): Promise<Set<number>> {
  const latest = await prisma.knowledgeArticleRevision.groupBy({
    by: ["articleId"],
    _max: { id: true },
  });
  return new Set(
    latest
      .map((row) => row._max.id)
      .filter((id): id is number => id !== null),
  );
}

async function pruneKnowledgeArticleRevision(cutoff: Date): Promise<number> {
  const keep = [...(await latestRevisionIdPerArticle())];

  return batchedDelete(
    (take) =>
      prisma.knowledgeArticleRevision.findMany({
        where: { createdAt: { lt: cutoff }, id: { notIn: keep } },
        select: { id: true },
        orderBy: { createdAt: "asc" },
        take,
      }),
    async (ids) => {
      const { count } = await prisma.knowledgeArticleRevision.deleteMany({
        where: { id: { in: ids, notIn: keep } },
      });
      return count;
    },
  );
}

/** One sweep across every audit trail. */
export async function pruneActivityTrails(): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_MS);
  const counts: string[] = [];
  let total = 0;

  const results: [string, number][] = [
    ["ticket_activity", await pruneTicketActivity(cutoff)],
    ["admin_activity", await pruneAdminActivity(cutoff)],
    [
      "automation_settings_revision",
      await pruneAutomationSettingsRevision(cutoff),
    ],
    ["knowledge_article_revision", await pruneKnowledgeArticleRevision(cutoff)],
  ];

  for (const [table, removed] of results) {
    if (removed > 0) {
      counts.push(`${table}=${removed}`);
      total += removed;
    }
  }

  // Silent when there is nothing to do, which is most days — same reasoning
  // as `prune-outbox.ts`'s own log line.
  if (total > 0) {
    console.log(`[activity-trails] pruned ${total} row(s): ${counts.join(" ")}`);
  }
}

/** Create the queue and start the sweep. Called once, from `./index`. */
export async function registerPruneActivityTrails(boss: PgBoss): Promise<void> {
  await boss.createQueue(PRUNE_QUEUE, {
    // One sweep at a time, no retries — a failed sweep sees the same rows
    // tomorrow and nothing downstream is waiting on it. Same shape as
    // `prune-outbox.ts`.
    policy: "singleton",
    retryLimit: 0,
    expireInSeconds: 300,
  });
  await boss.work(PRUNE_QUEUE, { batchSize: 1 }, async () => {
    await pruneActivityTrails();
  });
  await boss.schedule(PRUNE_QUEUE, PRUNE_CRON);
}
