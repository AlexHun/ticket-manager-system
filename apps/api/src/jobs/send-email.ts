import * as Sentry from "@sentry/bun";
import { fromPrisma, type PgBoss, type Queue } from "pg-boss";
import { prisma, type Prisma } from "../db";
import {
  MAIL_OUTCOME,
  RETRYABLE_OUTCOME,
  deliver,
  isMailConfigured,
} from "../mail/transport";
import { ensureQueue, getBoss } from "./boss";

/**
 * Handing an outbox row to a mail provider, off whatever transaction wrote it.
 *
 * **This is the half of the outbox that can do I/O.** The other half is a plain
 * INSERT any caller can make inside its own transaction, which is the entire
 * reason the table exists: `sendReply` is called *inside* `prisma.$transaction`
 * by `jobs/auto-reply-ticket.ts` so that the reply and the status transition
 * proving the worker still held its claim commit together, and an HTTP call
 * cannot go there. It would hold a Postgres transaction open across a round trip
 * to a third party, and a rollback cannot un-send an email.
 *
 * So the transaction writes a row and enqueues this job in the same breath — the
 * shape `ingest.ts` already uses for classification — and the network call
 * happens here, afterwards, outside any transaction. If the transaction rolls
 * back, the row and the job vanish together and nothing was sent. If it commits,
 * both survive a crash and the email goes out on the next boot.
 *
 * **The row is the source of truth; the job is only a nudge.** pg-boss delivers
 * at least once, so this handler re-reads the row and does nothing unless it is
 * still queued. That is the same guard the classifier uses, and for the same
 * reason: a job delivered twice or replayed after a crash must cost nothing.
 */

const SEND_EMAIL_QUEUE = "send-email";
const SEND_EMAIL_DEAD_QUEUE = "send-email-dead";

/**
 * One at a time, per process.
 *
 * Mail providers rate-limit, and a burst of outbound replies is exactly the
 * shape that trips one. There is no agent watching a spinner for any of this —
 * every producer has already committed its row and moved on — so throughput here
 * buys nothing that latency elsewhere would not buy more of.
 */
const LOCAL_CONCURRENCY = 1;

/**
 * The retry ladder: 30s, then roughly 60, 120 and 240, with jitter.
 *
 * Deliberately the same numbers as the classifier, because it is waiting for the
 * same kind of thing — somebody else's API having a bad minute. Five attempts
 * across about seven and a half minutes, then the dead-letter queue settles the
 * row as failed and stops.
 */
const RETRY_LIMIT = 4;
const RETRY_DELAY_SECONDS = 30;

/**
 * See the long note in `classify-ticket.ts`: NOTIFY fires on insert, not when a
 * retry becomes due, so on the 30s default every rung of the ladder above picks
 * up an extra delay of up to a full poll. Five seconds keeps retries honest.
 */
const NOTIFY_POLL_SECONDS = 5;

/**
 * How long a job may be active before pg-boss assumes the worker died.
 *
 * Well above any plausible provider timeout, and that margin is load-bearing: it
 * is the only thing standing between this design and a duplicate email. There is
 * no `sending` status and no claim on the row — the handler checks that the row
 * is queued and then makes the network call — so a worker stalled for longer
 * than this would have its job offered to a second worker, which would read the
 * same queued row and send it again.
 *
 * That was judged the right trade rather than overlooked. A claim state would
 * need a stuck-claim sweep to release rows whose worker died mid-send, which is
 * the machinery `Ticket.Processing` needs and earns; here it would guard against
 * a stall of over two minutes in a call that times out in well under one. If a
 * provider is ever bound whose timeout approaches this number, add the claim —
 * do not just raise this.
 */
const EXPIRE_IN_SECONDS = 180;

export interface SendEmailJob {
  outboundEmailId: number;
}

/** Everything needed to address one email, before it has a row. */
export interface EnqueueEmailInput {
  kind: Prisma.OutboundEmailCreateInput["kind"];
  /** The thread message this carries, if it carries one. Null for auth mail. */
  messageId?: number | null;
  toEmail: string;
  toName?: string | null;
  subject: string;
  textBody: string;
  /** Without angle brackets — see `OutgoingEmail` in `mail/transport.ts`. */
  emailMessageId?: string | null;
  inReplyTo?: string | null;
  references?: string[];
}

/**
 * Write an email to the outbox and ask for it to be sent.
 *
 * Pass `tx` to join a transaction the caller already opened, which every in-app
 * producer should: the thing being emailed and the record that it was emailed
 * belong to one commit.
 *
 * **Unlike `enqueueClassification`, this does not check whether the integration
 * is configured first**, and the difference is worth stating. A deployment with
 * no AI key has nothing to record, so enqueuing classification would only build
 * a backlog nobody asked for. A deployment with no mail provider still has an
 * email — a real password-reset link a real colleague needs — and the outbox row
 * *is* how it gets delivered, by an admin reading it off the screen. Writing the
 * row is the feature, not a preliminary to it.
 *
 * The job is enqueued either way, so the worker stays the single place that
 * decides what became of a row. It also means that the day a provider is bound,
 * nothing on this path runs in production for the first time.
 */
export async function enqueueEmail(
  input: EnqueueEmailInput,
  tx?: Prisma.TransactionClient,
): Promise<{ id: number }> {
  const write = async (client: Prisma.TransactionClient) => {
    const row = await client.outboundEmail.create({
      data: {
        kind: input.kind,
        messageId: input.messageId ?? null,
        toEmail: input.toEmail,
        toName: input.toName ?? null,
        subject: input.subject,
        textBody: input.textBody,
        emailMessageId: input.emailMessageId ?? null,
        inReplyTo: input.inReplyTo ?? null,
        references: input.references ?? [],
      },
      select: { id: true },
    });

    await getBoss().send(
      SEND_EMAIL_QUEUE,
      { outboundEmailId: row.id } satisfies SendEmailJob,
      { db: fromPrisma(client) },
    );

    return row;
  };

  if (tx) return write(tx);
  return prisma.$transaction(write);
}

/**
 * Try to send one outbox row.
 *
 * Returns normally on every terminal outcome and throws only on a retryable one,
 * so pg-boss's ladder is driven by the failure taxonomy in `mail/transport.ts`
 * rather than by anything decided here — the same split `classify-ticket.ts`
 * makes with `AiFailure`.
 */
async function handle({ outboundEmailId }: SendEmailJob): Promise<void> {
  const row = await prisma.outboundEmail.findUnique({
    where: { id: outboundEmailId },
    select: {
      id: true,
      status: true,
      toEmail: true,
      toName: true,
      subject: true,
      textBody: true,
      emailMessageId: true,
      inReplyTo: true,
      references: true,
    },
  });

  // Deleted, or already dealt with by an earlier delivery of this same job.
  // Neither is an error: at-least-once means this is a normal Tuesday.
  if (!row || row.status !== "queued") return;

  // Asked before the call rather than inferred from its result, so a deployment
  // with no provider never constructs a request at all.
  if (!isMailConfigured()) {
    await prisma.outboundEmail.updateMany({
      where: { id: row.id, status: "queued" },
      data: {
        status: "undeliverable",
        lastError:
          "No mail provider configured (POSTMARK_SERVER_TOKEN is unset)",
      },
    });
    return;
  }

  const result = await deliver({
    toEmail: row.toEmail,
    toName: row.toName,
    subject: row.subject,
    textBody: row.textBody,
    messageId: row.emailMessageId,
    inReplyTo: row.inReplyTo,
    references: row.references,
  });

  if (result.outcome === MAIL_OUTCOME.accepted) {
    // `updateMany` with the status in the `where`, not `update`: the row may
    // have been deleted with its ticket while the provider was thinking, and a
    // missing row must not fail the job and send the email a second time.
    await prisma.outboundEmail.updateMany({
      where: { id: row.id, status: "queued" },
      data: {
        status: "sent",
        sentAt: new Date(),
        providerMessageId: result.providerMessageId,
        attempts: { increment: 1 },
        lastError: null,
      },
    });
    return;
  }

  const retryable = RETRYABLE_OUTCOME[result.outcome];

  await prisma.outboundEmail.updateMany({
    where: { id: row.id, status: "queued" },
    data: {
      // A retryable failure leaves the row queued, because it is: this job is
      // coming back. Only a terminal outcome settles the row.
      status: retryable
        ? "queued"
        : result.outcome === MAIL_OUTCOME.unavailable
          ? "undeliverable"
          : "failed",
      attempts: { increment: 1 },
      lastError: result.error,
    },
  });

  // Thrown *after* the row is updated, so the attempt count and the reason
  // survive even though this invocation is about to be recorded as a failure.
  if (retryable) {
    throw new Error(`send-email deferred: ${result.error}`);
  }
}

/** Queue settings shared by the live queue and its dead-letter twin. */
const QUEUE_DEFAULTS: Omit<Queue, "name"> = {
  retryLimit: RETRY_LIMIT,
  retryDelay: RETRY_DELAY_SECONDS,
  retryBackoff: true,
  expireInSeconds: EXPIRE_IN_SECONDS,
};

/** Create the queues and start the workers. Called once, from `./index`. */
export async function registerSendEmail(boss: PgBoss): Promise<void> {
  // First: naming it on the live queue below requires it to exist. No retries of
  // its own — a job arrives here precisely because retrying stopped helping.
  await ensureQueue(boss, SEND_EMAIL_DEAD_QUEUE, { retryLimit: 0 });

  await ensureQueue(boss, SEND_EMAIL_QUEUE, {
    ...QUEUE_DEFAULTS,
    deadLetter: SEND_EMAIL_DEAD_QUEUE,
    notify: true,
  });

  await boss.work<SendEmailJob>(
    SEND_EMAIL_QUEUE,
    {
      batchSize: 1,
      localConcurrency: LOCAL_CONCURRENCY,
      notifyPollingIntervalSeconds: NOTIFY_POLL_SECONDS,
    },
    async ([job]) => {
      await handle(job!.data);
    },
  );

  // The dead-letter worker. Its whole job is to settle the row, so nothing is
  // left sitting in queued with no job coming for it — which is what an admin
  // looking at the outbox would read as "going out any moment now".
  await boss.work<SendEmailJob>(
    SEND_EMAIL_DEAD_QUEUE,
    { batchSize: 1 },
    async ([job]) => {
      const { outboundEmailId } = job!.data;
      console.error(
        `[send-email] outbound email ${outboundEmailId} exhausted its retries`,
      );
      // Reported here and at no earlier attempt. The ladder above exists because
      // a deferred outcome is expected to fail and expected to succeed on a
      // later rung; an alert per attempt would train everyone to ignore the
      // channel. Getting here means the ladder ran out and a customer or
      // colleague did not get their email. The id is a tag so every occurrence
      // groups into one issue.
      Sentry.withScope((scope) => {
        scope.setTag("queue", SEND_EMAIL_DEAD_QUEUE);
        scope.setContext("job", { outboundEmailId });
        Sentry.captureMessage("send-email exhausted its retries", "error");
      });
      await prisma.outboundEmail.updateMany({
        where: { id: outboundEmailId, status: "queued" },
        data: { status: "failed" },
      });
    },
  );
}
