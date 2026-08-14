import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { simulateEmailSchema } from "@ticket/core";
import {
  asAutoReplyDecline,
  AUTO_REPLY_DECLINES,
  DASHBOARD_RANGE,
  DASHBOARD_RANGE_DAYS,
  DECLINE_STAGE,
  DEFAULT_DASHBOARD_RANGE,
  MAX_TICKET_ID,
  MESSAGE_DIRECTION,
  PIPELINE_OUTCOME,
  PIPELINE_RECENT_LIMIT,
  PIPELINE_STAGE,
  PIPELINE_STAGES,
  PIPELINE_STAGE_STATE,
  SIMULATED_SENDER_DOMAIN,
  TICKET_STATUS,
  type AutoReplyDecline,
  type PipelineConfig,
  type PipelineCounts,
  type PipelineOverviewResponse,
  type PipelineQueueDepth,
  type PipelineRun,
  type PipelineRunResponse,
  type PipelineSimulateResponse,
  type PipelineStageResult,
  type PipelineStageState,
} from "@ticket/shared";
import { autoReplyArticleCount } from "../ai/knowledge-base";
import { isAiConfigured } from "../ai/provider";
import { prisma, type Prisma } from "../db";
import { findParentTicketId, INGEST_OUTCOME, ingestInboundEmail } from "../ingest";
import { AUTO_REPLY_QUEUE } from "../jobs/auto-reply-ticket";
import { getBoss } from "../jobs/boss";
import { CLASSIFY_QUEUE } from "../jobs/classify-ticket";
import { requireAdmin, sessionOf } from "../middleware/auth";

/**
 * The unattended pipeline, read back and fed.
 *
 * Two jobs, and they are here together because they are useless apart. The read
 * half reconstructs the path a ticket takes with nobody watching — arrive,
 * classify, gate, draft, check, resolve or hand back — from the columns the jobs
 * already write. The write half posts an email through the real ingestion code
 * so somebody can watch one ticket take it.
 *
 * **Admin only, on every route.** The read half exposes the shape of the queue
 * and how the safety checks are firing; the write half creates tickets and
 * spends model calls. Neither is an agent's business, and the second is a
 * capability nothing in this API had before — until now the only ways into the
 * ticket table were the webhook's shared secret and the seed script.
 *
 * Nothing here writes anything a job would not have written. There is no
 * `/pipeline` column, no simulated-ticket flag and no migration behind this
 * file: every number below is derived from `classifiedAt`, `category`, `status`,
 * `autoResolvedAt`, `autoReplyDecline` and the messages' `direction` /
 * `automated` / `citedArticleIds`. That the whole trace was already recoverable
 * is a property the schema had before this page existed; this is the first thing
 * to read it.
 */

export const pipelineRouter = Router();

// ---------------------------------------------------------------------------
// The simulator's constraints
// ---------------------------------------------------------------------------

/**
 * Whether this deployment accepts simulated email at all. Default **off**.
 *
 * Opt-in rather than opt-out, and that asymmetry is deliberate: a deployment
 * that forgot to think about this should be one that cannot inject tickets, not
 * one that can. `.env.example` turns it on for local development, so the only
 * place the decision has to be made consciously is the place it matters.
 */
function simulatorEnabled(): boolean {
  return process.env.PIPELINE_SIMULATOR_ENABLED === "true";
}

/**
 * How many simulated emails one session may send per window.
 *
 * Every send is a classification call and possibly an auto-reply call, so a loop
 * on this route is a bill rather than a nuisance. In-process and per-session,
 * matching the scale of the thing being protected — this is a demo control, not
 * a defence against a distributed attacker, and the real gate above it is
 * `requireAdmin`.
 */
const SIMULATE_LIMIT = 10;
const SIMULATE_WINDOW_MS = 60_000;

const simulateHits = new Map<string, number[]>();

function overSimulateLimit(sessionId: string): boolean {
  const now = Date.now();
  const recent = (simulateHits.get(sessionId) ?? []).filter(
    (t) => now - t < SIMULATE_WINDOW_MS,
  );

  if (recent.length >= SIMULATE_LIMIT) {
    simulateHits.set(sessionId, recent);
    return true;
  }

  recent.push(now);
  simulateHits.set(sessionId, recent);

  // The map is keyed by session and would otherwise grow for the life of the
  // process. Cheap to sweep here: this route is rate-limited by definition.
  if (simulateHits.size > 100) {
    for (const [key, hits] of simulateHits) {
      if (hits.every((t) => now - t >= SIMULATE_WINDOW_MS)) {
        simulateHits.delete(key);
      }
    }
  }

  return false;
}

/**
 * The `Message-ID` for a simulated email.
 *
 * Minted here and never accepted from the caller, so a simulation cannot claim
 * to be an existing thread or collide with one. `sim.` in front of the reserved
 * domain makes a simulated header recognisable at a glance in a mail log.
 */
function newSimulatedMessageId(): string {
  return `${Date.now()}.${crypto.randomUUID()}@${SIMULATED_SENDER_DOMAIN}`;
}

function isSimulatedAddress(email: string): boolean {
  return email.toLowerCase().endsWith(`@${SIMULATED_SENDER_DOMAIN}`);
}

// ---------------------------------------------------------------------------
// Reading the pipeline back
// ---------------------------------------------------------------------------

const pipelineQuerySchema = z.object({
  range: z
    .enum(DASHBOARD_RANGE, { error: "Invalid range" })
    .default(DEFAULT_DASHBOARD_RANGE),
});

const DAY_MS = 24 * 60 * 60 * 1_000;

/**
 * Which columns a run is rebuilt from. Exactly the ones the jobs write, plus
 * enough of the thread to answer "did anyone reply, and what did the machine
 * cite".
 */
const RUN_SELECT = {
  id: true,
  subject: true,
  customerName: true,
  status: true,
  category: true,
  classifiedAt: true,
  autoResolvedAt: true,
  autoReplyDecline: true,
  autoReplyDeclinedAt: true,
  createdAt: true,
  // The newest reply of any kind. Two questions at once: what the machine cited
  // (when it was the machine), and whether this ticket has been answered at all
  // — which is what tells a finished ticket apart from one still waiting.
  messages: {
    where: { direction: MESSAGE_DIRECTION.outbound },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 1,
    select: { automated: true, citedArticleIds: true },
  },
  // `satisfies` rather than `as const`: the latter makes the nested `orderBy`
  // array readonly, which Prisma's generated input types reject, and the error
  // it produces points at the whole select rather than at the array.
} satisfies Prisma.TicketSelect;

/** The row shape `RUN_SELECT` produces, derived rather than restated. */
type RunRow = Prisma.TicketGetPayload<{ select: typeof RUN_SELECT }>;

/**
 * Rebuild one ticket's trip down the rail.
 *
 * Every branch here is a fact a column records. What it deliberately does *not*
 * do is guess: a ticket with no classification verdict and a deployment with no
 * API key is `notOffered`, not "still thinking", because nothing is scheduled to
 * think about it.
 *
 * The one thing this cannot see is a reopen. A customer replying to a
 * machine-resolved ticket clears `autoResolvedAt` (see `ingest.ts`), so such a
 * ticket reads here exactly like one the machine never answered. That is a
 * limitation of the columns and it is stated on the page rather than papered
 * over with an inference.
 */
function toRun(row: RunRow, config: PipelineConfig): PipelineRun {
  const decline = asAutoReplyDecline(row.autoReplyDecline);
  const machineClassified = row.classifiedAt !== null && row.category !== null;
  const abandoned = row.classifiedAt !== null && row.category === null;
  const resolved = row.autoResolvedAt !== null;

  // Is anything still going to happen to this ticket? Two different answers,
  // because the two halves of the pipeline are switched off independently — one
  // key gates the classifier, and the kill switch plus an empty corpus gate the
  // auto-reply on their own. A ticket waiting on a stage nothing will ever run
  // is `notOffered`, never `pending`: "still thinking" about work that is not
  // scheduled is the one lie this page must not tell.
  const classifierWillRun = config.aiConfigured;
  const autoReplyWillRun =
    config.aiConfigured &&
    config.autoReplyEnabled &&
    config.autoReplyArticleCount > 0;

  // Already answered by somebody, and not currently claimed. The auto-reply is
  // enqueued exactly once, from the classify handler, so nothing is coming back
  // for this ticket however healthy the switches are.
  //
  // This is the shape a *reopened* ticket takes, and it is why the case needs
  // handling rather than falling through to `pending`. A customer replying to a
  // machine-resolved ticket clears `autoResolvedAt` (see `ingest.ts`), so the
  // one column that proved the machine answered is gone — leaving a classified,
  // unresolved, undeclined ticket that would otherwise be reported as still
  // being worked on, forever. It is also the shape of a ticket an agent simply
  // answered by hand.
  const answeredAlready =
    row.messages.length > 0 && row.status !== TICKET_STATUS.Processing;

  const outcome = resolved
    ? PIPELINE_OUTCOME.resolved
    : decline !== null
      ? PIPELINE_OUTCOME.declined
      : abandoned
        ? PIPELINE_OUTCOME.abandoned
        : !machineClassified
          ? classifierWillRun
            ? PIPELINE_OUTCOME.pending
            : PIPELINE_OUTCOME.notOffered
          : autoReplyWillRun && !answeredAlready
            ? PIPELINE_OUTCOME.pending
            : PIPELINE_OUTCOME.notOffered;

  // Where the ticket left the rail, if it did. `undefined` means it is still on
  // it — either finished at the bottom or somewhere in the middle right now.
  const exitStage = abandoned
    ? PIPELINE_STAGE.classified
    : decline !== null
      ? DECLINE_STAGE[decline]
      : undefined;

  // The furthest stop reached. On a success that is the bottom; otherwise it is
  // wherever the evidence runs out.
  const reachedIndex = resolved
    ? PIPELINE_STAGES.length - 1
    : exitStage !== undefined
      ? PIPELINE_STAGES.indexOf(exitStage)
      : machineClassified
        ? // Classified and neither resolved nor declined: a worker is composing,
          // or one is about to be. `Processing` is the claim, so it is the only
          // state that proves the auto-reply is running right now.
          row.status === TICKET_STATUS.Processing
          ? PIPELINE_STAGES.indexOf(PIPELINE_STAGE.drafted)
          : PIPELINE_STAGES.indexOf(PIPELINE_STAGE.classified)
        : PIPELINE_STAGES.indexOf(PIPELINE_STAGE.received);

  // Nothing more is coming, so no stop may render as in-flight. `notOffered`
  // counts: the ticket is stopped, it is simply stopped because the feature is
  // off rather than because it reached a verdict.
  const terminal = outcome !== PIPELINE_OUTCOME.pending;

  const stages: PipelineStageResult[] = PIPELINE_STAGES.map((stage, index) => {
    let state: PipelineStageState;
    if (exitStage === stage) {
      state = PIPELINE_STAGE_STATE.exited;
    } else if (index < reachedIndex) {
      state = PIPELINE_STAGE_STATE.done;
    } else if (index === reachedIndex) {
      state = terminal
        ? PIPELINE_STAGE_STATE.done
        : PIPELINE_STAGE_STATE.active;
    } else if (terminal) {
      state = PIPELINE_STAGE_STATE.skipped;
    } else {
      state = PIPELINE_STAGE_STATE.pending;
    }

    // Only three stops have an instant of their own. A successful auto-reply
    // stamps one time for the whole job, so `drafted` and `checked` have nothing
    // separate to report and say so with a null rather than borrowing one.
    const at =
      stage === PIPELINE_STAGE.received
        ? row.createdAt.toISOString()
        : stage === PIPELINE_STAGE.classified
          ? (row.classifiedAt?.toISOString() ?? null)
          : stage === PIPELINE_STAGE.resolved
            ? (row.autoResolvedAt?.toISOString() ?? null)
            : exitStage === stage
              ? (row.autoReplyDeclinedAt?.toISOString() ?? null)
              : null;

    return { stage, state, at };
  });

  return {
    ticketId: row.id,
    subject: row.subject,
    customerName: row.customerName,
    status: row.status,
    category: row.category,
    createdAt: row.createdAt.toISOString(),
    outcome,
    decline,
    declinedAt: row.autoReplyDeclinedAt?.toISOString() ?? null,
    // Only from an automated reply. An agent's own reply cites nothing, and
    // reading its empty array as "the machine cited nothing" would be a claim
    // about a message a person wrote.
    citedArticleIds:
      resolved && row.messages[0]?.automated
        ? row.messages[0].citedArticleIds
        : [],
    stages,
  };
}

async function readConfig(): Promise<PipelineConfig> {
  const aiConfigured = isAiConfigured();
  return {
    aiConfigured,
    autoReplyEnabled: process.env.AUTO_REPLY_ENABLED !== "false",
    // Skipped when there is no key: the corpus size cannot change the answer,
    // and this is the same short-circuit `autoReplyEnabled` in the job makes.
    autoReplyArticleCount: aiConfigured ? await autoReplyArticleCount() : 0,
    simulatorEnabled: simulatorEnabled(),
  };
}

/**
 * Live depth for one queue.
 *
 * Tolerant of a missing queue on purpose. `getQueue` returns null before
 * `registerClassifyTicket` has run, and a boot-order hiccup should leave this
 * page reporting zero rather than 500-ing the one screen you would open to find
 * out what is wrong.
 */
async function queueDepth(name: string): Promise<PipelineQueueDepth> {
  const queue = await getBoss().getQueue(name);
  if (!queue) return { ready: 0, active: 0, deferred: 0 };
  return {
    ready: queue.readyCount,
    active: queue.activeCount,
    deferred: queue.deferredCount,
  };
}

pipelineRouter.get(
  "/",
  requireAdmin,
  async (
    req: Request,
    res: Response<PipelineOverviewResponse | { error: string }>,
  ) => {
    const parsed = pipelineQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]!.message });
      return;
    }

    const { range } = parsed.data;
    const days = DASHBOARD_RANGE_DAYS[range];

    // Pinned once, so every number in the response describes the same window.
    const to = new Date();
    const from = new Date(to.getTime() - days * DAY_MS);
    const window = { createdAt: { gte: from, lt: to } };

    const [
      config,
      received,
      machineClassified,
      classifyAbandoned,
      autoResolved,
      declineGroups,
      recentRows,
      classify,
      autoReply,
    ] = await Promise.all([
      readConfig(),
      prisma.ticket.count({ where: window }),
      prisma.ticket.count({
        where: { ...window, classifiedAt: { not: null }, category: { not: null } },
      }),
      prisma.ticket.count({
        where: { ...window, classifiedAt: { not: null }, category: null },
      }),
      prisma.ticket.count({ where: { ...window, autoResolvedAt: { not: null } } }),
      prisma.ticket.groupBy({
        by: ["autoReplyDecline"],
        where: { ...window, autoReplyDecline: { not: null } },
        _count: { _all: true },
      }),
      prisma.ticket.findMany({
        where: window,
        select: RUN_SELECT,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: PIPELINE_RECENT_LIMIT,
      }),
      queueDepth(CLASSIFY_QUEUE),
      queueDepth(AUTO_REPLY_QUEUE),
    ]);

    // Every reason, including the zeroes. A zero here is information — it is the
    // difference between "that check has never fired" and "we do not measure it".
    const declines = Object.fromEntries(
      AUTO_REPLY_DECLINES.map((d) => [d, 0]),
    ) as Record<AutoReplyDecline, number>;
    for (const group of declineGroups) {
      const reason = asAutoReplyDecline(group.autoReplyDecline);
      if (reason) declines[reason] += group._count._all;
    }

    const counts: PipelineCounts = {
      received,
      machineClassified,
      classifyAbandoned,
      classifyPending: received - machineClassified - classifyAbandoned,
      autoResolved,
      declines,
    };

    res.json({
      config,
      range,
      from: from.toISOString(),
      to: to.toISOString(),
      counts,
      queues: { classify, autoReply },
      recent: recentRows.map((row) => toRun(row, config)),
    });
  },
);

const ticketIdSchema = z.coerce.number().int().positive().max(MAX_TICKET_ID);

pipelineRouter.get(
  "/runs/:id",
  requireAdmin,
  async (
    req: Request,
    res: Response<PipelineRunResponse | { error: string }>,
  ) => {
    const parsed = ticketIdSchema.safeParse(req.params.id);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid ticket id" });
      return;
    }

    const [config, row] = await Promise.all([
      readConfig(),
      prisma.ticket.findUnique({
        where: { id: parsed.data },
        select: RUN_SELECT,
      }),
    ]);

    if (!row) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }

    res.json({ run: toRun(row, config) });
  },
);

// ---------------------------------------------------------------------------
// Feeding it
// ---------------------------------------------------------------------------

/**
 * Post an email as if a customer had sent it.
 *
 * It goes through `ingestInboundEmail`, which is the same function the Postmark
 * webhook calls — that is the entire justification for this route existing. A
 * simulator with its own ingestion logic would show you the simulator working.
 *
 * Three things the caller does not get to choose, and each closes a hole that
 * only opens once Phase 3's mail transport lands:
 *
 *   - **the sender's domain.** The caller sends a localpart; the address is
 *     assembled onto `SIMULATED_SENDER_DOMAIN`, which RFC 2606 reserves. An
 *     admin session may make the desk answer itself. It may not choose who the
 *     desk writes to, and that is the difference between a demo tool and a way
 *     to send mail from someone else's support address.
 *   - **the `Message-ID`.** Minted here, so a simulation cannot impersonate or
 *     collide with a real thread.
 *   - **what it may reply to.** `inReplyTo` is checked below before ingestion:
 *     it must land on a ticket whose customer is themselves simulated. You can
 *     thread onto a ticket you made; you cannot forge a customer message onto a
 *     real person's thread — which would put words in a customer's mouth in a
 *     record an agent reads and trusts.
 */
pipelineRouter.post(
  "/simulate",
  requireAdmin,
  async (
    req: Request,
    res: Response<PipelineSimulateResponse | { error: string }>,
  ) => {
    if (!simulatorEnabled()) {
      res.status(503).json({
        error:
          "The pipeline simulator is off. Set PIPELINE_SIMULATOR_ENABLED=true to turn it on.",
      });
      return;
    }

    const parsed = simulateEmailSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]!.message });
      return;
    }

    const session = sessionOf(res);
    if (overSimulateLimit(session.session.id)) {
      res.status(429).json({
        error: `Too many simulated emails — ${SIMULATE_LIMIT} a minute. Each one costs a model call.`,
      });
      return;
    }

    const { localPart, senderName, subject, textBody, htmlBody, inReplyTo } =
      parsed.data;

    if (inReplyTo) {
      const parentTicketId = await findParentTicketId(inReplyTo);
      if (parentTicketId === null) {
        res.status(400).json({
          error: "Nothing in the database has that Message-ID.",
        });
        return;
      }

      const parent = await prisma.ticket.findUnique({
        where: { id: parentTicketId },
        select: { customerEmail: true },
      });

      // The restriction, and the reason it is here rather than in `ingest.ts`:
      // it is this route's policy, not a rule about receiving email. The webhook
      // must keep threading real replies onto real tickets.
      if (!parent || !isSimulatedAddress(parent.customerEmail)) {
        res.status(403).json({
          error:
            "That Message-ID belongs to a real customer's thread. Simulated replies may only thread onto simulated tickets.",
        });
        return;
      }
    }

    const result = await ingestInboundEmail({
      messageId: newSimulatedMessageId(),
      subject,
      senderEmail: `${localPart.toLowerCase()}@${SIMULATED_SENDER_DOMAIN}`,
      senderName,
      // Empty means absent. An HTML-only email is a real thing customers send
      // and the pipeline has a branch for it (`noText`); sending `""` instead of
      // nothing would store an empty string and take the wrong branch.
      textBody: textBody.trim() || undefined,
      htmlBody: htmlBody.trim() || undefined,
      inReplyTo: inReplyTo || undefined,
    });

    console.log(
      `[pipeline] ${session.user.email} simulated an email → ticket ${result.ticketId} (${result.outcome})`,
    );

    res.status(201).json({
      ticketId: result.ticketId,
      threaded: result.outcome !== INGEST_OUTCOME.created,
      messageId: result.messageId,
    });
  },
);
