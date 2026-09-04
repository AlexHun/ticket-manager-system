import * as Sentry from "@sentry/bun";
import { PgBoss, type Queue } from "pg-boss";

/**
 * The job queue's lifecycle and the recipe every queue is made from — and
 * nothing about which queues those are.
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
 *
 * What it does know is what a queue *means* here: a live queue and its
 * dead-letter twin, the retry ladder they share, the poll interval that keeps a
 * due retry honest, and the alert that fires when the ladder runs out. Those
 * were re-typed in all three worker files — byte-identical defaults, a copy of
 * the poll-interval constant with its measured note, and a copy-pasted alert
 * block down to the tags — which meant the invariants that define a queue in
 * this app lived in the consumers rather than in the module named for them
 * (#154). `registerWorker` below is where they live now.
 *
 * There are **two kinds of queue here and only two**, so there are two
 * registrars: `registerWorker` for work somebody asked for, and `registerSweep`
 * for work a clock asks for. They differ in every setting that matters — a
 * worker retries a ladder into a dead-letter twin, a sweep is a singleton that
 * never retries because the next tick sees the same rows — which is why one
 * function with a flag would be two functions wearing a coat. What they share is
 * the property #144 bought: settings are reapplied on every boot, for every
 * queue, without a consumer having to know that `createQueue` alone would not.
 *
 * Between them they are the *whole* surface. A consumer names a queue, declares
 * what it needs, and hands it over; nothing outside this module calls pg-boss's
 * own `createQueue`, `work` or `schedule` any more (#158), and `boss.test.ts`
 * reads the directory to keep it that way.
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

/**
 * The retry ladder: 30s, then roughly 60, 120 and 240, with jitter.
 *
 * Sized against what every worker here is waiting for — somebody else's API
 * having a bad minute. A rate limit clears in seconds and a provider incident in
 * minutes, so the early rungs are close together and the last is far enough out
 * to sit through a short outage. Five attempts in about seven and a half
 * minutes, then the dead-letter queue.
 *
 * One ladder rather than one per queue, and that is a finding rather than a
 * tidy-up: the classifier, the auto-reply and the sender each arrived at these
 * same two numbers independently, because the thing being waited on is the same
 * thing. A queue that genuinely needs a different ladder is a queue that is
 * waiting for something else, and it should say so here — with the reason —
 * rather than in a constant of its own.
 */
const RETRY_LIMIT = 4;
const RETRY_DELAY_SECONDS = 30;

/**
 * How often a worker polls while LISTEN/NOTIFY is up.
 *
 * pg-boss defaults this to 30s on the reasoning that NOTIFY already wakes a
 * worker the moment a job is inserted, so polling is only a backstop. That
 * reasoning has a hole, and it cost an afternoon to find: **NOTIFY fires on
 * insert, not when a retry becomes due.** A job that failed and is waiting out
 * its backoff is not inserted again — it changes state in place — so nothing
 * wakes anyone, and every rung of the ladder above picks up an extra delay of up
 * to the backstop interval. Measured on the default: a one-second retry delay
 * took 58 seconds to run.
 *
 * Five seconds keeps retries roughly honest without turning the backstop back
 * into the primary mechanism. First delivery is still immediate via NOTIFY; this
 * only governs how late a *retry* can be.
 */
const NOTIFY_POLL_SECONDS = 5;

/**
 * What a live queue's dead-letter twin is called.
 *
 * Derived rather than named by each consumer, so the pair cannot be half
 * declared: a queue that names a `deadLetter` pg-boss has never been asked to
 * create is a queue whose exhausted jobs go nowhere.
 */
const DEAD_LETTER_SUFFIX = "-dead";

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
 *
 * **Not exported.** It was, until every consumer had a registrar to use instead
 * (#158) — and while it was, "make a queue" and "make *this app's* kind of
 * queue" were two things a caller had to choose between, with only the second
 * one carrying the pair, the ladder, the poll interval and the singleton policy.
 * Four scheduled queues chose the first. The two registrars below are now the
 * only callers and the only way in.
 */
async function ensureQueue(
  boss: PgBoss,
  name: string,
  options: Omit<Queue, "name">,
): Promise<void> {
  await boss.createQueue(name, options);

  const { policy: _policy, partition: _partition, ...updatable } = options;
  await boss.updateQueue(name, updatable);
}

/**
 * Everything a worker knows that this module cannot.
 *
 * Three of the five fields are the ones the issue named — a name, a handler, and
 * what to do when the retries are gone. The other two are here because they are
 * genuinely per-worker and each is argued at its own site: `concurrency` is
 * about what the work competes with (the classifier and the auto-reply share a
 * provider account with features an agent is watching a spinner for; the sender
 * is throttled by a mail provider instead), and `expireInSeconds` is about how
 * long one attempt can legitimately take. Neither has a defensible shared value,
 * which is exactly the test the retry ladder above passes and these two fail.
 *
 * `T` is the job payload, and it is a `Record` rather than an `object` because
 * the exhaustion alert attaches it to the Sentry scope verbatim — declare the
 * payload types with `type`, not `interface`, or they will not satisfy it.
 */
export interface WorkerSpec<T extends Record<string, unknown>> {
  /** The live queue's name. Its dead-letter twin is derived from it. */
  name: string;
  /** Concurrent jobs on this node. One worker each, never a shared batch. */
  concurrency: number;
  /**
   * How long a job may be active before pg-boss assumes the worker died and
   * offers it to someone else. Set it comfortably over the handler's own
   * ceiling, so a slow attempt is never mistaken for a dead one.
   */
  expireInSeconds: number;
  /**
   * Do the work. Throw to ask for a retry, return to say the matter is closed —
   * that is the whole contract with pg-boss. Delivery is at-least-once, so this
   * must cost nothing when it arrives twice.
   */
  handle: (data: T) => Promise<void>;
  /**
   * Put the world right after the ladder ran out.
   *
   * Runs on the dead-letter queue, which is not a graveyard: every worker here
   * has left something claimed, unstamped or unsettled that no later job is
   * coming for, and this is where it is released. The log line and the alert are
   * already made by the time this is called — what belongs here is the repair,
   * not the reporting.
   */
  onExhausted: (data: T) => Promise<void>;
}

/**
 * Create a worker's pair of queues and start both of its workers.
 *
 * The recipe, in one place, for the shape all three consumers had written out
 * by hand:
 *
 * **The dead-letter queue is created first**, because naming it on the live
 * queue requires it to exist. It takes no retries of its own — a job arrives
 * there precisely because retrying stopped being the answer.
 *
 * **Both queues go through `ensureQueue`**, so both have their settings
 * reapplied on every boot rather than frozen at whatever the constants said the
 * day they were first created (#144; the note on `ensureQueue` is the story).
 *
 * **`batchSize: 1` with `localConcurrency`, never a batch.** A batch shares its
 * fate, so one job's transient failure would drag its neighbours back through
 * the retry ladder with it. Independent workers each fetch and fail on their own.
 *
 * **The exhaustion alert fires here and at no earlier attempt.** The ladder
 * above exists because these failures are expected to fail and expected to
 * succeed on a later rung; an alert per attempt would train everyone to ignore
 * the channel. The queue name is the message and the payload is a context, so
 * every occurrence groups into one issue rather than one issue per ticket.
 *
 * One log line, from here rather than from each `onExhausted`, for the same
 * reason: two error lines per exhaustion is the kind of noise that gets a filter
 * written for it, and the consequence — released, stamped, settled — is one
 * function call away in the consumer, where it is code rather than prose.
 */
export async function registerWorker<T extends Record<string, unknown>>(
  boss: PgBoss,
  spec: WorkerSpec<T>,
): Promise<void> {
  const deadLetter = `${spec.name}${DEAD_LETTER_SUFFIX}`;

  await ensureQueue(boss, deadLetter, { retryLimit: 0 });

  await ensureQueue(boss, spec.name, {
    retryLimit: RETRY_LIMIT,
    retryDelay: RETRY_DELAY_SECONDS,
    retryBackoff: true,
    expireInSeconds: spec.expireInSeconds,
    deadLetter,
    // Wake workers on insert instead of waiting out a poll, which keeps the
    // near-instant pickup the in-memory queue this replaced had. It degrades
    // rather than breaks behind a transaction-mode pooler, where a session-scoped
    // LISTEN cannot survive: pg-boss falls back to polling on its own.
    notify: true,
  });

  await boss.work<T>(
    spec.name,
    {
      batchSize: 1,
      localConcurrency: spec.concurrency,
      notifyPollingIntervalSeconds: NOTIFY_POLL_SECONDS,
    },
    async ([job]) => {
      await spec.handle(job!.data);
    },
  );

  await boss.work<T>(deadLetter, { batchSize: 1 }, async ([job]) => {
    const data = job!.data;
    console.error(`[jobs] ${spec.name} exhausted its retries`, data);
    Sentry.withScope((scope) => {
      scope.setTag("queue", deadLetter);
      scope.setContext("job", data);
      Sentry.captureMessage(`${spec.name} exhausted its retries`, "error");
    });
    await spec.onExhausted(data);
  });
}

/**
 * Everything a scheduled sweep knows that this module cannot.
 *
 * Three fields where a worker needs five, and the two that are missing are the
 * argument for a second registrar rather than a flag on the first. There is no
 * `concurrency`, because `policy: "singleton"` below decides that for every
 * sweep and no sweep has ever wanted otherwise; and there is no `onExhausted`,
 * because nothing here retries, so there is no ladder to run out of.
 *
 * `expireInSeconds` stays per-sweep for the same reason it is per-worker: it is
 * how long *this* sweep may legitimately take, and the four of them disagree
 * (the two that re-enqueue tickets are sized like the workers they feed; the two
 * that delete in batches are given longer). A shared value would be a number
 * that fits neither pair.
 */
export interface SweepSpec {
  /** The queue's name. No dead-letter twin: nothing here is retried. */
  name: string;
  /** When it runs, as pg-boss's cron. */
  cron: string;
  /**
   * How long one sweep may be active before pg-boss assumes the process died.
   * Set it over the sweep's own ceiling — every sweep here bounds its work by
   * batch count, so that ceiling is a number the consumer can actually argue.
   */
  expireInSeconds: number;
  /**
   * Do the sweep. Takes no payload: a cron tick carries nothing, and everything
   * one of these needs to know is in the rows it reads.
   *
   * Never throws to ask for a retry — see the queue settings below. A sweep that
   * fails has already lost nothing, because the next tick reads the same rows.
   */
  run: () => Promise<void>;
}

/**
 * Create a sweep's queue, work it, and put it on the clock.
 *
 * The recipe the four scheduled queues had each written out by hand:
 *
 * **`policy: "singleton"`**, so a tick that arrives while the last one is still
 * running does not start a second. Every sweep here reads a batch and writes to
 * the rows it read; two at once would do the same work twice and race on it.
 *
 * **`retryLimit: 0`**, which is the one place a consumer is allowed to differ
 * from the ladder in `registerWorker` — and the reason it is allowed is that
 * this is not a shorter ladder, it is the absence of one. A failed sweep sees
 * exactly the same rows on the next tick, minutes away, with nothing downstream
 * waiting; retrying it sooner would buy a duplicate rather than a recovery.
 *
 * **Through `ensureQueue`, like everything else**, so a change to the constants
 * above or to a sweep's expiry reaches a queue that already exists. That was the
 * bug #144 fixed and these four queues are the ones it was found on — created
 * once, then frozen at whatever the constants said that day, silently, for the
 * life of the deployment.
 *
 * **`boss.schedule` on every boot.** pg-boss upserts a schedule rather than
 * stacking them, so this is idempotent, and it is what makes a changed cron
 * expression take effect on deploy rather than never. Only one node in a cluster
 * runs the cron, which is what keeps a scaled-out API from sweeping N times.
 */
export async function registerSweep(
  boss: PgBoss,
  spec: SweepSpec,
): Promise<void> {
  await ensureQueue(boss, spec.name, {
    policy: "singleton",
    retryLimit: 0,
    expireInSeconds: spec.expireInSeconds,
  });

  await boss.work(spec.name, { batchSize: 1 }, async () => {
    await spec.run();
  });

  await boss.schedule(spec.name, spec.cron);
}

/** Stop polling, let in-flight work finish, and release the pool. */
export async function stopBoss(): Promise<void> {
  if (!boss) return;

  const stopping = boss;
  boss = undefined;
  await stopping.stop({ graceful: true, timeout: STOP_TIMEOUT_MS });
  console.log("[jobs] pg-boss stopped");
}
