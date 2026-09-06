/**
 * One `enqueueEmail` stub, shared by every test file that provokes an email
 * (#172; lifted out of `outbound.test.ts`, where #171 wrote it).
 *
 * ## Why a module rather than a copy per file
 *
 * `mock.module`'s registry is one process wide and nothing resets it between
 * files, so two files registering their own factory for `../jobs/send-email`
 * would not be independent: whichever loaded first would decide what the other
 * one got. `docs/standards/testing.md` describes the hazard and the two ways
 * out of it — write the two stubs *deliberately identical* (what the four
 * `../middleware/auth` stubs do), or put the callers in one file. Neither fits
 * here. This stub is not header constants; it holds **state** — the
 * `failAfterWriting` switch `outbound.test.ts` flips to test a rollback — and
 * two identical copies of a stateful stub are two boxes, of which the registry
 * keeps one and the other file's switch then does nothing. So there is one
 * module, registered once, and both files flip the same box.
 *
 * That is the same move #189 made on the route-test server, and it is available
 * for the same reason: the thing being shared is machinery, not identity.
 *
 * ## Why the seam is this module
 *
 * `enqueueEmail` writes the outbox row **into the caller's transaction** and
 * then hands pg-boss a job. The row is the half every caller's test is about;
 * the nudge is the half that cannot run here — `getBoss()` throws "Job queue
 * used before startBoss()" with no boss started, and because the real
 * `enqueueEmail` wraps its own insert in `prisma.$transaction` when no `tx` is
 * passed, that throw *rolls the row back*. Measured, on the path that matters:
 * `auth.ts`'s `sendResetPassword` catches the error, logs it, and leaves an
 * empty `outbound_email` table behind — so the invitation `routes/users.ts`
 * sends would be untestable without this.
 *
 * Moving the seam one module down to `../jobs/boss` would run the real
 * `enqueueEmail` end to end, and is the thing not to do: `jobs/sweeps.test.ts`
 * already registers a `./boss` factory of its own, so that would put a second,
 * differently-behaved factory on a specifier another file owns — the hazard
 * above, with load order deciding whose tests are wrong.
 *
 * ## What it is not
 *
 * It is a copy of the real insert, so it pins *what a caller asked for*, not
 * that `jobs/send-email.ts` writes the columns it says it does. A column added
 * to the real insert leaves every caller of this asserting last month's row
 * shape, green. `jobs/send-email.ts` still has no test of its own; that is the
 * gap to close, and it is that module's to close.
 */
import { mock } from "bun:test";
import { prisma, type Prisma } from "./pg";

/**
 * The switch, and the reason this is a module rather than a copied block.
 *
 * `failAfterWriting` reproduces the shape `getBoss().send()` fails in — a queue
 * that is unreachable or was never started — *after* the outbox row has been
 * written, which is what makes it a test of the caller's transaction rather
 * than of the stub. Thrown here rather than provoked out of the real
 * `enqueueEmail` because whether the real `getBoss` is even the one in force
 * depends on whether `jobs/sweeps.test.ts` registered its `./boss` fake first,
 * which depends on the order `bun test` reaches the files in. A rollback test
 * that only fails on CI is worth less than a rollback test.
 *
 * Reset it in the same `beforeEach` that calls `resetDb()`. It is shared state
 * between files by construction; leaving it on would leak.
 */
export const sendEmail = { failAfterWriting: false };

let installed = false;

/**
 * Register the stub. Call it at module scope, **after** the file's
 * `mock.module("../db", …)` — this imports `../jobs/send-email`, which imports
 * `../db`, and the real one throws without `DATABASE_URL`.
 *
 * Idempotent: the second caller gets the first caller's registration, which is
 * the entire point.
 */
export async function stubSendEmail(): Promise<void> {
  if (installed) return;
  installed = true;

  // Spread now, before the mock is registered, so `requeueEmail`,
  // `SEND_EMAIL_WORKER` and `registerSendEmail` stay genuine for
  // `routes/outbox.ts` and `boss.test.ts` whichever order the suite reaches
  // them in.
  const actual = { ...(await import("../jobs/send-email")) };
  type EnqueueEmailInput = Parameters<typeof actual.enqueueEmail>[0];

  mock.module("../jobs/send-email", () => ({
    ...actual,
    enqueueEmail: async (
      input: EnqueueEmailInput,
      tx?: Prisma.TransactionClient,
    ) => {
      // The real module's insert, minus the `getBoss().send()` beneath it. The
      // client is the caller's transaction when there is one, which is the
      // property `outbound.test.ts` is about.
      const row = await (tx ?? prisma).outboundEmail.create({
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

      if (sendEmail.failAfterWriting) {
        throw new Error("send-email: the queue is unreachable");
      }
      return row;
    },
  }));
}
