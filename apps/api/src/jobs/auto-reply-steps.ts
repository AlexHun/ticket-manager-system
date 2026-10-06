import {
  autoReply,
  type AutoReplyContext,
  type AutoReplyResult,
} from "../ai/auto-reply";
import type { KbArticle } from "../ai/knowledge-base";
import type { Prisma } from "../db";

/**
 * The two steps of `./auto-reply-ticket.ts` that its test has to stand in for,
 * and nothing else.
 *
 * A module of its own for the reason `../evals/reply-to-case.ts` is one
 * (`docs/adr/0016`, testing-api.md). `auto-reply-ticket.test.ts` needs the model
 * to answer, and `../ai/auto-reply.test.ts` imports `../ai/auto-reply` to test
 * that very function, so a factory on that specifier would hand one of the two
 * files a stranger's stub depending on load order. Only the job imports this
 * module, so its test has a specifier nothing else loads for real.
 *
 * **Functions, never `export { autoReply } from …`**: a re-export's binding is
 * the source module's, and rewiring it rewrites `autoReply` itself (#303).
 */

/** Ask the model for a reply. */
export function draftReply(
  articles: KbArticle[],
  context: AutoReplyContext,
): Promise<AutoReplyResult> {
  return autoReply(articles, context);
}

/**
 * The ticket as the resolving transaction sees it: what the gates read, its
 * status, and the two columns that make up its version (#429).
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
      lastMessageAt: true,
      messages: { select: { direction: true } },
    },
  });
}

export type ResolveState = NonNullable<
  Awaited<ReturnType<typeof readResolveState>>
>;
