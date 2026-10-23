import type { Prisma } from "../db";

/**
 * The one step of `./auto-reply-ticket.ts` that its test has to wrap, and
 * nothing else.
 *
 * A module of its own so the job's test has a specifier nothing else loads for
 * real (`docs/adr/0016`, testing-api.md): only the job imports this. It held a
 * second step until #580, `draftReply`, a one-line shim over `autoReply` that
 * existed so the test could answer for the model without registering
 * `../ai/auto-reply`, which `ai/auto-reply.test.ts` tests. The test scripts the
 * preload's fake model now, and the job calls `autoReply` itself.
 */

/**
 * The ticket as the resolving transaction sees it: what the gates read, and its
 * status, which tells a ticket someone else released from one whose version
 * moved (#429).
 *
 * Taken on `tx`, so it reads inside the transaction that resolves. The test
 * wraps this to commit a message through the same `tx` after the read and
 * before the resolve — the interleaving the version compare exists for, which
 * PGLite cannot produce from a second connection because it has only one.
 */
export function readResolveState(
  tx: Prisma.TransactionClient,
  ticketId: number,
) {
  return tx.ticket.findUnique({
    where: { id: ticketId },
    select: {
      status: true,
      category: true,
      messages: { select: { direction: true } },
    },
  });
}

export type ResolveState = NonNullable<
  Awaited<ReturnType<typeof readResolveState>>
>;
