import { Router } from "express";
import type { Request, Response } from "express";
import { polishReplySchema } from "@ticket/core";
import { MESSAGE_DIRECTION, type PolishReplyResponse } from "@ticket/shared";
import {
  POLISH_FAILURE,
  isPolishConfigured,
  polishDraft,
  type PolishFailure,
} from "../ai/polish";
import { prisma } from "../db";
import { requireAuth, sessionOf } from "../middleware/auth";

export const aiRouter = Router();

/** Polish requests one user may make per window. A person polishes a draft once or twice. */
const MAX_PER_WINDOW = 10;
const WINDOW_MS = 60_000;

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
 * Admission timestamps per user id, oldest first.
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

/** Forget users whose whole window has expired, so the map cannot grow without bound. */
function sweep(now: number): void {
  for (const [userId, times] of admissions) {
    const last = times[times.length - 1];
    if (last === undefined || now - last >= WINDOW_MS) admissions.delete(userId);
  }
}

type Admission =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

function admit(userId: string): Admission {
  const now = Date.now();
  const recent = (admissions.get(userId) ?? []).filter(
    (at) => now - at < WINDOW_MS,
  );

  if (recent.length >= MAX_PER_WINDOW) {
    // Store the pruned list even on refusal, so a blocked caller doesn't carry
    // expired timestamps into their next attempt.
    admissions.set(userId, recent);
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
  admissions.set(userId, recent);
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
    const admission = admit(user.id);
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
