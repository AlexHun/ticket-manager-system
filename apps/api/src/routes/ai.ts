import { Router } from "express";
import type { Request, Response } from "express";
import { polishReplySchema, summarizeTicketSchema } from "@ticket/core";
import {
  MESSAGE_DIRECTION,
  type PolishReplyResponse,
  type SummarizeTicketResponse,
} from "@ticket/shared";
import {
  POLISH_FAILURE,
  isPolishConfigured,
  polishDraft,
  type PolishFailure,
} from "../ai/polish";
import { AI_FAILURE, isAiConfigured, type AiFailure } from "../ai/provider";
import { summarizeTicket, type SummaryMessage } from "../ai/summarize";
import { prisma } from "../db";
import { requireAuth, sessionOf } from "../middleware/auth";

export const aiRouter = Router();

/**
 * Requests one user may make to one endpoint per window.
 *
 * A person polishes a draft once or twice, and re-summarises a ticket when the
 * conversation has moved. Ten of either in a minute is already someone leaning
 * on the button.
 */
const MAX_PER_WINDOW = 10;
const WINDOW_MS = 60_000;

/**
 * The rate-limit buckets, one per endpoint.
 *
 * Scoping the budget by endpoint as well as by user is the point: a shared
 * counter would let ten polishes lock an agent out of summarising, which is a
 * feature they have not touched and a limit they cannot see the reason for.
 * These are cost guards on two different calls, so they count separately.
 */
const BUDGET = {
  polish: "polish",
  summary: "summary",
} as const;

type Budget = (typeof BUDGET)[keyof typeof BUDGET];

/** The rate-limit key: one budget, one user. */
function budgetKey(budget: Budget, userId: string): string {
  return `${budget}:${userId}`;
}

/**
 * How often the map is swept, counted in admissions rather than in time.
 *
 * A `setInterval` is the obvious way and the worse one: it needs `.unref()` or
 * it holds the process open, and it keeps waking a server nobody is using.
 * Amortising the sweep over admissions costs exactly nothing while the endpoint
 * is idle, which is most of the time.
 */
const SWEEP_EVERY = 100;

/**
 * Admission timestamps per budget key, oldest first.
 *
 * In memory, and therefore per *process*: two API instances behind a load
 * balancer allow ten each, and a restart or a `bun --hot` reload clears the
 * lot. That is accepted — this is a cost guard, not a security control. A
 * counter shared across instances means Redis, which `tech-stack.md` defers, and
 * nothing here is protecting data.
 *
 * Keyed by the session's user id and never by IP: `requireAuth` has already
 * resolved an identity, and an office behind one NAT would otherwise share a
 * single budget between everyone in it.
 */
const admissions = new Map<string, number[]>();
let admitted = 0;

/** Forget keys whose whole window has expired, so the map cannot grow without bound. */
function sweep(now: number): void {
  for (const [key, times] of admissions) {
    const last = times[times.length - 1];
    if (last === undefined || now - last >= WINDOW_MS) admissions.delete(key);
  }
}

type Admission =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

function admit(key: string): Admission {
  const now = Date.now();
  const recent = (admissions.get(key) ?? []).filter(
    (at) => now - at < WINDOW_MS,
  );

  if (recent.length >= MAX_PER_WINDOW) {
    // Store the pruned list even on refusal, so a blocked caller doesn't carry
    // expired timestamps into their next attempt.
    admissions.set(key, recent);
    const oldest = recent[0] ?? now;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((WINDOW_MS - (now - oldest)) / 1000),
      ),
    };
  }

  recent.push(now);
  admissions.set(key, recent);
  if (++admitted % SWEEP_EVERY === 0) sweep(now);
  return { allowed: true };
}

/** What each failure is worth telling the agent. One sentence, all actionable. */
const FAILURE_RESPONSE: Record<
  PolishFailure,
  { status: number; error: string }
> = {
  [POLISH_FAILURE.provider]: {
    status: 502,
    error: "Polishing failed — try again, or send your draft as it is.",
  },
  [POLISH_FAILURE.busy]: {
    status: 503,
    error: "The writing assistant is busy right now — try again in a moment.",
  },
  // Deliberately not "try again": an empty balance does not refill on its own,
  // and an agent clicking hopefully at a button is the outcome to avoid. Says
  // what to do instead — send the draft — and names the thing an admin has to
  // fix, without naming the key itself.
  [POLISH_FAILURE.quota]: {
    status: 503,
    error:
      "Polishing is unavailable — the AI account is out of credit. Send your draft as it is.",
  },
  [POLISH_FAILURE.auth]: {
    status: 503,
    error:
      "Polishing is unavailable — the server's AI credentials were rejected.",
  },
  // The server log carries the provider's own sentence, which names the offending
  // model or parameter. The agent gets none of that: they cannot act on it, and
  // it would only tell them to retry something that cannot start working.
  [POLISH_FAILURE.config]: {
    status: 503,
    error:
      "Polishing is misconfigured on this server — the AI request was rejected. Send your draft as it is.",
  },
  [POLISH_FAILURE.empty]: {
    status: 502,
    error: "Polishing came back empty — try again, or send your draft as it is.",
  },
  // Says what happened without teaching anyone how it happened. "The rewrite
  // offered a refund your draft didn't" would tell an agent something useful and
  // would also tell whoever planted it that the payload was seen and named.
  [POLISH_FAILURE.invented]: {
    status: 502,
    error:
      "Polishing added a commitment your draft didn't make, so it was discarded. Try again, or send your draft as it is.",
  },
};

/**
 * Rewrite an agent's draft reply, in the context of the ticket it answers.
 *
 * `requireAuth` like the ticket routes, and that is the whole authorisation
 * story even now that this reads a ticket: an agent can already fetch any ticket
 * and its entire thread through `GET /api/tickets/:id`, so a subject line and
 * one inbound message discloses nothing a signed-in caller could not read
 * directly. Nothing is written.
 *
 * Still `/api/ai` rather than `/api/tickets/:id/polish-reply`, though the second
 * reading is now defensible — the ticket is a genuine input rather than a lie
 * the path would tell. It stays here because the resource being acted on is the
 * draft in the composer, which is not a ticket sub-resource: it has no id, it is
 * never persisted, and the answer never touches the thread. The ticket is
 * context for the rewrite, not the thing being rewritten.
 */
aiRouter.post(
  "/polish-reply",
  requireAuth,
  async (
    req: Request,
    res: Response<PolishReplyResponse | { error: string }>,
  ) => {
    // First, and before the body is even looked at: on a deployment with no key
    // the answer is the same for every request, and saying so plainly beats a
    // failed provider call that was never going to work.
    if (!isPolishConfigured()) {
      res
        .status(503)
        .json({ error: "Polishing isn't configured on this server." });
      return;
    }

    // `?? {}` so a bodyless request fails on the missing field and gets the same
    // sentence as an empty one, matching `POST /:id/messages`.
    const body = polishReplySchema.safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ error: body.error.issues[0].message });
      return;
    }

    const { user } = sessionOf(res);

    // What the rewrite is answering, read here rather than accepted from the
    // body: the customer's words go into a prompt, so the one copy that reaches
    // the model is the one in our own thread. A caller who could send that text
    // could hand the model any "customer message" they liked.
    const ticket = await prisma.ticket.findUnique({
      where: { id: body.data.ticketId },
      select: {
        subject: true,
        customerName: true,
        messages: {
          // The customer's latest, which is what a reply is a reply to. Only
          // inbound: the agent's own previous messages are already reflected in
          // the draft, and feeding them back invites the model to re-answer
          // them.
          where: { direction: MESSAGE_DIRECTION.inbound },
          // Newest first, `id` breaking the tie exactly as the thread query
          // does — createdAt defaults to now() and a batch insert shares an
          // instant.
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
          // `textBody` alone. `htmlBody` is stored and never leaves this
          // process — see the "never render email HTML" rule — and a prompt is
          // not the exception that starts: it would put markup in front of the
          // model and tags into the agent's draft box.
          select: { textBody: true },
        },
      },
    });

    if (!ticket) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }

    // After validation and the lookup, before the model. The budget exists to
    // cap spend, and neither a malformed body nor a missing ticket costs
    // anything to refuse, so only a request that would actually reach the
    // provider consumes a slot. It is never refunded on failure either: a
    // provider that is down, retried ten times a minute, is precisely what this
    // guard is here to stop.
    const admission = admit(budgetKey(BUDGET.polish, user.id));
    if (!admission.allowed) {
      res.setHeader("Retry-After", String(admission.retryAfterSeconds));
      res.status(429).json({
        error: "You've polished a lot of drafts just now — try again in a minute.",
      });
      return;
    }

    // A closed tab or a navigation should stop us paying for the rest of the
    // generation.
    const abort = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) abort.abort();
    });

    const result = await polishDraft(
      body.data.draft,
      {
        subject: ticket.subject,
        customerName: ticket.customerName,
        // Null when the thread has no inbound message at all, and null again
        // when the newest one is HTML-only — `textBody` is nullable, and an
        // empty string is the same absence as far as the prompt is concerned.
        customerMessage: ticket.messages[0]?.textBody?.trim() || null,
        agentName: user.name,
      },
      abort.signal,
    );
    if (!result.ok) {
      const { status, error } = FAILURE_RESPONSE[result.reason];
      if (result.reason === POLISH_FAILURE.busy) {
        res.setHeader("Retry-After", "10");
      }
      res.status(status).json({ error });
      return;
    }

    res.json({ polished: result.text });
  },
);

/**
 * What each failure is worth telling the agent, for a summary rather than a
 * rewrite.
 *
 * Its own table rather than a template over `FAILURE_RESPONSE`, because the
 * useful half of each sentence is the fallback advice, and the two features have
 * different fallbacks. "Send your draft as it is" is a real answer for a polish;
 * the equivalent here is that the thread is on screen already, so the summary is
 * a shortcut an agent can do without. A shared template could produce the
 * statuses but not that.
 *
 * Keyed by `AiFailure`, so there is no `invented` case: that check belongs to
 * `polishDraft`, which is guarding what leaves for a customer.
 */
const SUMMARY_FAILURE_RESPONSE: Record<
  AiFailure,
  { status: number; error: string }
> = {
  [AI_FAILURE.provider]: {
    status: 502,
    error: "Couldn't summarise this ticket — try again, or read the thread below.",
  },
  [AI_FAILURE.busy]: {
    status: 503,
    error: "The summariser is busy right now — try again in a moment.",
  },
  // Deliberately not "try again": an empty balance does not refill on its own,
  // and an agent clicking hopefully at a button is the outcome to avoid.
  [AI_FAILURE.quota]: {
    status: 503,
    error: "Summaries are unavailable — the AI account is out of credit.",
  },
  [AI_FAILURE.auth]: {
    status: 503,
    error: "Summaries are unavailable — the server's AI credentials were rejected.",
  },
  // The server log carries the provider's own sentence, which names the
  // offending model or parameter. The agent gets none of that: they cannot act
  // on it, and it would only tell them to retry something that cannot start
  // working.
  [AI_FAILURE.config]: {
    status: 503,
    error: "Summarising is misconfigured on this server — the AI request was rejected.",
  },
  // Covers a budget spent on reasoning and an answer that wasn't the schema.
  // Both look the same from here and have the same remedy.
  [AI_FAILURE.empty]: {
    status: 502,
    error: "The summary came back empty — try again.",
  },
};

/**
 * Summarise a ticket and its conversation history.
 *
 * `requireAuth` and no more, on the same reasoning as the polish endpoint: an
 * agent can already fetch this ticket and its entire thread through
 * `GET /api/tickets/:id`, so a summary of it discloses nothing a signed-in
 * caller could not read directly. Nothing is written, and nothing is cached —
 * every request generates afresh, which is what the panel asks for.
 *
 * Unlike polishing, the thread is read *whole*. That is the feature: a summary
 * of the latest inbound message is not a summary of the conversation. The prompt
 * size is bounded inside `summarizeTicket`, by characters rather than by a
 * `take` here, so that a long thread loses its middle rather than either of its
 * ends.
 */
aiRouter.post(
  "/summarize-ticket",
  requireAuth,
  async (
    req: Request,
    res: Response<SummarizeTicketResponse | { error: string }>,
  ) => {
    // First, and before the body is even looked at: on a deployment with no key
    // the answer is the same for every request.
    if (!isAiConfigured()) {
      res
        .status(503)
        .json({ error: "Summarising isn't configured on this server." });
      return;
    }

    // `?? {}` so a bodyless request fails on the missing field and gets the same
    // sentence as an empty one, matching the endpoint above.
    const body = summarizeTicketSchema.safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ error: body.error.issues[0].message });
      return;
    }

    const { user } = sessionOf(res);

    const ticket = await prisma.ticket.findUnique({
      where: { id: body.data.ticketId },
      select: {
        subject: true,
        customerName: true,
        status: true,
        category: true,
        messages: {
          // Oldest first, `id` breaking the tie exactly as the thread query
          // does — createdAt defaults to now() and a batch insert shares an
          // instant. Order matters more here than anywhere else in the app: the
          // summary is a story about what happened when.
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          // No `htmlBody`, and not merely because nothing renders it. The
          // "never render email HTML" rule extends to prompts: it would put
          // markup in front of the model and tags into the summary.
          select: {
            direction: true,
            senderName: true,
            textBody: true,
            createdAt: true,
          },
        },
      },
    });

    if (!ticket) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }

    // HTML-only emails store no `textBody` and are dropped here rather than sent
    // as blanks — a numbered gap in the thread would invite the model to guess
    // what was in it. They still count towards `messageCount` below, which is
    // the client's own view of how long the thread is.
    const messages: SummaryMessage[] = ticket.messages.flatMap((message) => {
      const text = message.textBody?.trim() ?? "";
      if (text.length === 0) return [];
      return [
        {
          direction: message.direction,
          senderName: message.senderName,
          sentAt: message.createdAt.toISOString(),
          text,
        },
      ];
    });

    // After validation and the lookup, before the model — the same order as the
    // endpoint above, and for the same reason: a malformed body or a missing
    // ticket costs nothing to refuse, so only a request that would actually
    // reach the provider spends a slot. Its own budget, so an agent who has been
    // polishing drafts can still summarise.
    const admission = admit(budgetKey(BUDGET.summary, user.id));
    if (!admission.allowed) {
      res.setHeader("Retry-After", String(admission.retryAfterSeconds));
      res.status(429).json({
        error: "You've asked for a lot of summaries just now — try again in a minute.",
      });
      return;
    }

    // A closed tab or a navigation should stop us paying for the rest of the
    // generation.
    const abort = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) abort.abort();
    });

    const result = await summarizeTicket(
      {
        subject: ticket.subject,
        customerName: ticket.customerName,
        status: ticket.status,
        category: ticket.category,
        messages,
      },
      abort.signal,
    );
    if (!result.ok) {
      const { status, error } = SUMMARY_FAILURE_RESPONSE[result.reason];
      if (result.reason === AI_FAILURE.busy) {
        res.setHeader("Retry-After", "10");
      }
      res.status(status).json({ error });
      return;
    }

    res.json({
      summary: result.summary,
      // The whole thread's length, not `messages.length`: this is what the panel
      // compares against its own copy to notice that a reply has landed since,
      // and the client counts HTML-only messages too.
      messageCount: ticket.messages.length,
    });
  },
);
