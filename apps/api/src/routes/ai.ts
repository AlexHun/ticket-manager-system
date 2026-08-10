import { Router } from "express";
import type { Request, Response } from "express";
import { polishReplySchema } from "@ticket/core";
import type { PolishReplyResponse } from "@ticket/shared";
import {
  POLISH_FAILURE,
  isPolishConfigured,
  polishDraft,
  type PolishFailure,
} from "../ai/polish";
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
};

/**
 * Rewrite an agent's draft reply.
 *
 * `requireAuth` like the ticket routes: both roles work tickets. Nothing is read
 * or written — the request carries the only input and the response carries the
 * only output — so there is no resource to authorise beyond being signed in.
 *
 * Not mounted under `/api/tickets/:id` even though that is where it is used
 * from. The prompt is the draft and nothing else: no subject, no thread, no
 * customer text. A ticket id in the URL would have to be either validated and
 * then ignored, or looked up purely so the path wasn't a lie. `/api/ai` says the
 * true thing about what this touches.
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

    // After validation, before the model. The budget exists to cap spend and a
    // malformed body costs nothing to refuse, so only a request that would
    // actually reach the provider consumes a slot. It is never refunded on
    // failure either: a provider that is down, retried ten times a minute, is
    // precisely what this guard is here to stop.
    const { user } = sessionOf(res);
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

    const result = await polishDraft(body.data.draft, abort.signal);
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
