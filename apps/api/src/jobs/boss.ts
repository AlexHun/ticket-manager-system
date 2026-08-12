import * as Sentry from "@sentry/bun";
import { PgBoss, type Queue } from "pg-boss";

/**
 * The job queue's lifecycle, and nothing about what runs on it.
 *
 * Background work in this app is Postgres-backed rather than Redis-backed, which
 * is the whole reason it exists at all: `tech-stack.md` deferred a queue with
 * "add a queue only when timeouts or retries demand it" and deferred Redis
 * outright. pg-boss needs neither a new service nor a new connection string — it
 * runs in the database already in the stack, in its own `pgboss` schema, so
 * adopting it costs a dependency rather than a deployment.
 *
 * What made retries start demanding it: classification's failure taxonomy
 * (`AiFailure`) splits transient from terminal, and the in-memory queue this
 * replaced could act on neither. A ticket that arrived during a five-minute
 * provider blip stayed uncategorised forever, and a restart lost whatever was
 * waiting without a trace. Both are the kind of quiet wrong that nobody reports.
 *
 * This module deliberately knows about no queue by name. `./index` wires the
 * registrations, so a second consumer — Phase 3's outbound Postmark send is the
 * obvious next one — is added there rather than here.
 */

/**
 * pg-boss owns this schema completely: its tables, its indexes, and its own
 * migration history, applied by `start()` below.
 *
 * That is a second migration system living beside Prisma's, which is worth
 * naming rather than discovering. They do not collide — Prisma manages `public`
 * and has no idea this exists — but `prisma migrate reset` will not recreate it
 * and does not need to: `start()` re-provisions on the next boot. A test
 * database wiped between runs is therefore self-healing.
 */
const SCHEMA = "pgboss";

/**
 * Connections pg-boss may open, separate from Prisma's pool.
 *
 * Small on purpose. Prisma's adapter pool serves requests an agent is waiting
 * on, and a background poller has no business competing for those. Two is enough
 * for a worker fetch plus a maintenance query, and the binding constraint in
 * production is the hosted Postgres connection ceiling — Neon and Supabase both
 * count these against a limit that the API process is already spending.
 */
const MAX_CONNECTIONS = 2;

/**
 * How long a graceful stop may take before the process stops waiting.
 *
 * Long enough for an in-flight classification to finish (the model call is
 * capped at 20s), short enough that a hung job cannot hold a deploy open. Work
 * that does not finish in time is not lost: the job returns to the queue and is
 * picked up by whatever starts next, which is the entire point of moving off an
 * in-memory array.
 */
const STOP_TIMEOUT_MS = 30_000;

let boss: PgBoss | undefined;

/**
 * The running instance, for code that needs to enqueue.
 *
 * Throws rather than returning undefined: every caller is inside a request that
 * is about to promise something, and a silent no-op would be a ticket nothing
 * ever classifies. If this throws, the API is serving requests without having
 * finished booting, which is a bug in the startup order and not a condition to
 * paper over.
 */
export function getBoss(): PgBoss {
  if (!boss) {
    throw new Error("Job queue used before startBoss() — check startup order");
  }
  return boss;
}

/**
 * Connect, provision the schema, and hand back the instance for registration.
 *
 * Failures propagate and take the boot with them. That is deliberate, and it is
 * the opposite of how the AI key is treated in `ai/provider.ts` — a missing
 * `OPENAI_API_KEY` is a supported state because the features it gates are
 * optional, whereas an API that is up but silently running no background work is
 * the hardest kind of broken to notice. It matters more with every consumer
 * added: an outbound email that appears sent and never leaves is worse than a
 * process that refused to start.
 */
export async function startBoss(): Promise<PgBoss> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  const instance = new PgBoss({
    connectionString,
    schema: SCHEMA,
    max: MAX_CONNECTIONS,
  });

  // Not optional. `PgBoss` is an `EventEmitter`, and an emitted `error` with no
  // listener is an unhandled error event, which takes the process down — so the
  // one thing guaranteed to kill the API would be the queue reporting that it
  // could not reach the database for a moment.
  instance.on("error", (err) => {
    console.error("[jobs] pg-boss error:", err);
    // Worth reporting even though it is survivable: this is the queue telling
    // us it lost the database. Nothing else in the app would say so, and the
    // symptom an agent notices — tickets that never get categorised — is hours
    // downstream of the cause.
    Sentry.captureException(err, { tags: { component: "pg-boss" } });
  });

  await instance.start();
  boss = instance;
  console.log(`[jobs] pg-boss started (schema "${SCHEMA}")`);

  return instance;
}

/**
 * Create a queue, or bring an existing one up to date.
 *
 * `createQueue` is a no-op when the queue already exists — it does not reconcile
 * settings — and queues live in the database, not in a source file. So on every
 * deployment after the first, editing a retry constant and restarting changes
 * nothing at all: the constant says one thing and the running queue does another,
 * silently and forever. That was not hypothetical; it is exactly what happened
 * the first time the classifier's numbers were tuned, and the only symptom was a
 * retry ladder that did not match the source.
 *
 * `updateQueue` after `createQueue` makes the source authoritative again. It
 * cannot carry `policy` or `partition` — pg-boss will not change those on a live
 * queue — so those stay create-only, and changing one means deleting the queue.
 *
 * Generic enough to live here: it takes the name as an argument, so this module
 * still knows no queue by name.
 */
export async function ensureQueue(
  boss: PgBoss,
  name: string,
  options: Omit<Queue, "name">,
): Promise<void> {
  await boss.createQueue(name, options);

  const { policy: _policy, partition: _partition, ...updatable } = options;
  await boss.updateQueue(name, updatable);
}

/** Stop polling, let in-flight work finish, and release the pool. */
export async function stopBoss(): Promise<void> {
  if (!boss) return;

  const stopping = boss;
  boss = undefined;
  await stopping.stop({ graceful: true, timeout: STOP_TIMEOUT_MS });
  console.log("[jobs] pg-boss stopped");
}
