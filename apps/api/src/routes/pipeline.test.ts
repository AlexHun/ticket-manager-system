/**
 * Unit tests for `apps/api/src/routes/pipeline.ts` — specifically `toRun`, the
 * one place in this codebase that derives both a Stage and an Outcome from a
 * ticket row.
 *
 * The file exists because that derivation had no test at all and `toRun` was
 * private, so the only way to ask it anything was an HTTP route against a live
 * database — which is why the defect `docs/adr/0019` records (an outage
 * reported as a *decline*, on the one screen built to teach that those are
 * different things) was found by reading rather than by a failure. It is
 * exported now, and the table below pins every decline reason against
 * `DECLINE_OUTCOME` as a value, the same move #212 made for the evals read
 * model.
 *
 * Two seams, deliberately:
 *
 *   - **`toRun` as a function**, over rows built here. It is total over its
 *     evidence and takes its `PipelineConfig` and the classifier's answer as
 *     parameters, so every branch — including the classifier's, which depends
 *     on a deployment's key — is reachable without a database or an environment.
 *   - **`GET /runs/:id` over a real socket and a real Postgres** (`../test/pg`,
 *     ADR-0014), for the claims a value table cannot make: that a ticket
 *     *handed back by `onExhausted`* reads as `abandoned`, running the job's own
 *     terminal path against the real columns rather than seeding the state
 *     somebody believes that path writes; and which unstamped rows the
 *     classifier will still act on, which is a query (#361).
 *
 * `GET /` is not reached over a socket, and that is a limitation worth naming
 * rather than working around: it reads queue depth through `getBoss()`, which
 * throws with no queue started, and the seam that would answer it — `./boss` —
 * is already owned by `jobs/sweeps.test.ts` with a *stateful* factory. A second
 * factory on that specifier is the process-wide registry hazard
 * `docs/standards/testing-api.md` describes, not a tidier arrangement. Its two
 * halves are called here instead: what it does with a row is `toRun` per row,
 * reached through `GET /runs/:id`, and its counts are `pipelineCounts`, run
 * against the real Postgres (#355). That the two agree across one `GET /` is
 * `tests/e2e/pipeline-offer.spec.ts`, against a server whose queue is running.
 */

import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  AUTO_REPLY_DECLINE,
  AUTO_REPLY_DECLINES,
  CLASSIFY_NOT_OFFERED,
  DECLINE_OUTCOME,
  DECLINE_STAGE,
  MESSAGE_DIRECTION,
  PIPELINE_OUTCOME,
  PIPELINE_STAGE,
  PIPELINE_STAGE_STATE,
  PIPELINE_STAGES,
  TICKET_CATEGORY,
  TICKET_STATUS,
  type AutoReplyDecline,
  type PipelineConfig,
  type PipelineRunResponse,
} from "@ticket/shared";
import { prisma, resetDb } from "../test/pg";
import { COLLEAGUE, seedColleagues, seedTicket } from "../test/fixtures";
import { serveRouter } from "../test/route-app";

/**
 * Set before anything below is imported, and the same string the three `ai/*`
 * test files use.
 *
 * `ai/provider.ts` reads the key into a module-level `const` at import and Bun
 * evaluates a module once per process, so whichever file links it first decides
 * what every other file sees (`docs/standards/testing-api.md`). This one links
 * it transitively — `routes/pipeline.ts` → `../ai/knowledge-base` — so it has to
 * answer the same way `polish.test.ts` and `auto-reply.test.ts` do, or it
 * silently unconfigures the AI features for whichever of them loads after it.
 * Nothing here depends on the value: `toRun` takes its config as a parameter.
 */
process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";

/** Deliberately identical to `knowledge.test.ts` / `tutorials.test.ts` — see
 *  the registry note in `docs/standards/testing-api.md`. */
const fakeGuard = (req: Request, res: Response, next: NextFunction) => {
  res.locals.session = {
    user: {
      id: req.header("x-test-user") ?? "agent-1",
      name: req.header("x-test-agent-name") ?? "Aaron Agent",
      email: req.header("x-test-user-email") ?? "agent@example.com",
      isAnonymous: req.header("x-test-demo") === "true",
    },
    session: { id: req.header("x-test-session") ?? "sess-1" },
  };
  next();
};

mock.module("../middleware/auth", () => ({
  requireAuth: fakeGuard,
  requireAdmin: fakeGuard,
  requireAdminView: fakeGuard,
  sessionOf: (res: Response) => res.locals.session,
}));

const { pipelineCounts, pipelineRouter, toRun } = await import("./pipeline");
const { AUTO_REPLY_WORKER } = await import("../jobs/auto-reply-ticket");
const { RECONCILE_MAX_AGE_MS } = await import("../jobs/classify-ticket");

type RunRow = Parameters<typeof toRun>[0];

/* ── The rows and the deployment ─────────────────────────────────────────── */

const CREATED_AT = new Date("2026-09-01T09:00:00.000Z");
const CLASSIFIED_AT = new Date("2026-09-01T09:00:12.000Z");
/**
 * `toRun`'s `awaitingClassifier` for a stamped row. The rule it answers asks for
 * no verdict yet, so the database answers false for every row `row()` builds.
 */
const NOT_AWAITING = false;

/** Everything on and nothing withheld: the deployment where the pipeline runs. */
const LIVE: PipelineConfig = {
  aiConfigured: true,
  autoReplyEnabled: true,
  autoReplyArticleCount: 12,
  simulatorEnabled: false,
};

/**
 * A ticket the classifier filed, in whatever state the caller needs.
 *
 * Classified with a category by default, because that is the only state from
 * which a decline is reachable at all — the auto-reply is enqueued from the
 * classify handler.
 */
function row(overrides: Partial<RunRow> = {}): RunRow {
  return {
    id: 1,
    subject: "Video keeps buffering",
    customerName: "Marta",
    status: TICKET_STATUS.Open,
    category: TICKET_CATEGORY.Technical,
    classifiedAt: CLASSIFIED_AT,
    autoResolvedAt: null,
    autoReplyDecline: null,
    autoReplyDeclinedAt: null,
    autoReplyOfferedAt: null,
    createdAt: CREATED_AT,
    messages: [],
    ...overrides,
  };
}

/** When `enqueueAutoReply` recorded the offer, in rows that need one. */
const OFFERED_AT = new Date("2026-09-01T09:00:12.500Z");

/** A ticket handed back with one reason, exactly as `release` stamps it. */
function declinedRow(decline: AutoReplyDecline): RunRow {
  return row({
    autoReplyDecline: decline,
    autoReplyDeclinedAt: new Date("2026-09-01T09:00:31.000Z"),
  });
}

/* ── The outcome a decline reason derives ────────────────────────────────── */

describe("toRun — the outcome it derives from a decline", () => {
  test.each([...AUTO_REPLY_DECLINES])(
    "%s answers the outcome `DECLINE_OUTCOME` names for it",
    (decline) => {
      expect(toRun(declinedRow(decline), LIVE, NOT_AWAITING).outcome).toBe(
        DECLINE_OUTCOME[decline],
      );
    },
  );

  test("an outage is `abandoned`, not `declined`", () => {
    // The defect ADR-0019 records, written out as a value rather than left to
    // the table above — a test that only reads `DECLINE_OUTCOME` would follow
    // that record wherever somebody moved it. `unavailable` is stamped by three
    // unrelated things (an emptied corpus, a call whose budget went on
    // reasoning, a provider that could not be reached) and none of them is a
    // verdict about the ticket: nothing was decided, so nothing may be reported
    // as the knowledge base having been consulted and found wanting.
    const run = toRun(
      declinedRow(AUTO_REPLY_DECLINE.unavailable),
      LIVE,
      NOT_AWAITING,
    );

    expect(run.outcome).toBe(PIPELINE_OUTCOME.abandoned);
    expect(run.decline).toBe(AUTO_REPLY_DECLINE.unavailable);
  });

  test("the nine verdicts are still `declined`", () => {
    // The other half of the same claim: the fix narrows one member and leaves
    // every real decline alone.
    for (const decline of AUTO_REPLY_DECLINES) {
      if (decline === AUTO_REPLY_DECLINE.unavailable) continue;
      expect(toRun(declinedRow(decline), LIVE, NOT_AWAITING).outcome).toBe(
        PIPELINE_OUTCOME.declined,
      );
    }
  });

  test("the stop it left the rail at is unchanged by any of that", () => {
    // The Stage and the Outcome answer different questions off the same column,
    // and only the second one moved. `unavailable` still exits at `drafted` —
    // that is where the attempt died — which is why the exit could never have
    // been read as the verdict in the first place.
    for (const decline of AUTO_REPLY_DECLINES) {
      const run = toRun(declinedRow(decline), LIVE, NOT_AWAITING);
      const exited = run.stages.find(
        (stage) => stage.state === PIPELINE_STAGE_STATE.exited,
      );
      expect(exited?.stage).toBe(DECLINE_STAGE[decline]);
    }
  });

  test("every stop below the exit is skipped, whichever outcome it answered", () => {
    // `terminal` keys off "not pending", so an outcome moving from `declined` to
    // `abandoned` must not put a stop back in flight on a ticket nothing is
    // coming back for.
    const run = toRun(
      declinedRow(AUTO_REPLY_DECLINE.unavailable),
      LIVE,
      NOT_AWAITING,
    );
    const below = PIPELINE_STAGES.indexOf(PIPELINE_STAGE.drafted) + 1;

    expect(run.stages.slice(below).map((stage) => stage.state)).toEqual(
      run.stages.slice(below).map(() => PIPELINE_STAGE_STATE.skipped),
    );
  });
});

/* ── The outcomes no decline reason is involved in ───────────────────────── */

describe("toRun — the rest of the outcomes", () => {
  test("answered from the knowledge base is `resolved`", () => {
    const run = toRun(
      row({
        status: TICKET_STATUS.Resolved,
        autoResolvedAt: new Date("2026-09-01T09:00:29.000Z"),
        messages: [{ automated: true, citedArticleIds: ["KB-001"] }],
      }),
      LIVE,
      NOT_AWAITING,
    );

    expect(run.outcome).toBe(PIPELINE_OUTCOME.resolved);
    expect(run.citedArticleIds).toEqual(["KB-001"]);
  });

  test("the classifier out of retries is `abandoned` too, with no reason", () => {
    // The other road to `abandoned`, and the reason its wording has to be true
    // of more than one thing: a stamped `classifiedAt` with no category is the
    // classifier's terminal path, which never reached the auto-reply at all.
    const run = toRun(row({ category: null }), LIVE, NOT_AWAITING);

    expect(run.outcome).toBe(PIPELINE_OUTCOME.abandoned);
    expect(run.decline).toBeNull();
  });

  test("waiting on a stage that will run is `pending`", () => {
    const run = toRun(
      row({ status: TICKET_STATUS.New, autoReplyOfferedAt: OFFERED_AT }),
      LIVE,
      NOT_AWAITING,
    );
    expect(run.outcome).toBe(PIPELINE_OUTCOME.pending);
  });
});

/* ── Whether the auto-reply was offered the ticket ───────────────────────── */

describe("toRun — the auto-reply's offer is read off the row", () => {
  test("classified with no offer recorded is `notOffered`, on a deployment where it is on today", () => {
    // R1, the bug this record exists for (#360). A ticket classified while the
    // auto-reply was switched off, or before its corpus had an article, was
    // never enqueued, and nothing will enqueue it now. Guessed from today's
    // settings it read `pending` forever once the switch went back on. A row
    // from before the column reads the same way, which is R7.
    const run = toRun(row({ status: TICKET_STATUS.New }), LIVE, NOT_AWAITING);

    expect(run.outcome).toBe(PIPELINE_OUTCOME.notOffered);
    expect(run.stages.map((stage) => stage.state)).not.toContain(
      PIPELINE_STAGE_STATE.pending,
    );
  });

  test("offered, and the switch turned off since, is still `pending`", () => {
    // The other half of reading the record rather than the settings. The job
    // is already queued and the handler never re-reads the switch, so a verdict
    // is coming whatever the deployment says today.
    const run = toRun(
      row({ status: TICKET_STATUS.New, autoReplyOfferedAt: OFFERED_AT }),
      {
        ...LIVE,
        aiConfigured: false,
        autoReplyEnabled: false,
        autoReplyArticleCount: 0,
      },
      NOT_AWAITING,
    );
    expect(run.outcome).toBe(PIPELINE_OUTCOME.pending);
  });

  test("offered, and answered by somebody since, is `notOffered`", () => {
    // A record of an offer is not a promise of a verdict once somebody has
    // replied: this is the reopened ticket's shape, and one an agent answered
    // by hand, and `toRun` reads both as nothing more to come.
    const run = toRun(
      row({
        status: TICKET_STATUS.Open,
        autoReplyOfferedAt: OFFERED_AT,
        messages: [{ automated: false, citedArticleIds: [] }],
      }),
      LIVE,
      NOT_AWAITING,
    );
    expect(run.outcome).toBe(PIPELINE_OUTCOME.notOffered);
  });
});

/* ── A ticket the classifier has not stamped ─────────────────────────────── */

describe("toRun — a ticket with no classification verdict", () => {
  /** Never stamped by the classifier, and not filed by a person either. */
  function unstamped(): RunRow {
    return row({
      status: TICKET_STATUS.New,
      category: null,
      classifiedAt: null,
    });
  }

  // Which rows the classifier will still act on is the database's answer
  // (`classifierWillStillAct`), asked by the routes and pinned against real
  // rows under `GET /api/pipeline/runs/:id` below. What `toRun` still decides
  // is what that answer means beside the deployment's key.

  test("awaited by the classifier is `pending`", () => {
    const run = toRun(unstamped(), LIVE, true);
    expect(run.outcome).toBe(PIPELINE_OUTCOME.pending);
  });

  test("not awaited is `notOffered`, with nothing left in flight", () => {
    const run = toRun(unstamped(), LIVE, false);

    expect(run.outcome).toBe(PIPELINE_OUTCOME.notOffered);
    expect(run.stages.map((stage) => stage.state)).not.toContain(
      PIPELINE_STAGE_STATE.pending,
    );
  });

  test("awaited, on a deployment with no key, is `notOffered`", () => {
    // `enqueueClassification` sends nothing without a key, so the rule being
    // true of the row schedules nothing.
    const run = toRun(unstamped(), { ...LIVE, aiConfigured: false }, true);
    expect(run.outcome).toBe(PIPELINE_OUTCOME.notOffered);
  });
});

/* ── The app ─────────────────────────────────────────────────────────────── */

const url = serveRouter("/api/pipeline", pipelineRouter);

const ADMIN = {
  "x-test-user": COLLEAGUE.admin.id,
  "x-test-agent-name": COLLEAGUE.admin.name,
  "x-test-user-email": COLLEAGUE.admin.email,
};

beforeEach(async () => {
  await resetDb();
  // The handoff target and the actor `release` records the decline as: both are
  // real rows the job reads, not stand-ins this file could type for itself.
  await seedColleagues("admin", "assistant");
});

describe("pipelineCounts — an unstamped ticket", () => {
  // Pinned, as the overview pins its `to`: the reconcile boundary is read at
  // this instant, so a row an hour inside it is inside it whenever this runs.
  const TO = new Date("2026-09-10T12:00:00.000Z");
  const FROM = new Date(TO.getTime() - 30 * 24 * 60 * 60 * 1_000);
  const AN_HOUR_AGO = new Date(TO.getTime() - 60 * 60 * 1_000);

  test("is pending only while the classifier will still act on it", async () => {
    // Fresh and unfiled: the ingest enqueue or the sweep is still coming.
    await seedTicket({ createdAt: AN_HOUR_AGO });
    // Exactly at the boundary: the sweep's `gte` still takes it.
    await seedTicket({
      createdAt: new Date(TO.getTime() - RECONCILE_MAX_AGE_MS),
    });
    // Filed by a person: `handle` skips it.
    await seedTicket({
      createdAt: AN_HOUR_AGO,
      category: TICKET_CATEGORY.Technical,
    });
    // Unfiled and a millisecond past the window: nothing re-offers it.
    await seedTicket({
      createdAt: new Date(TO.getTime() - RECONCILE_MAX_AGE_MS - 1),
    });
    // The two stamped shapes, so the split is read beside them.
    await seedTicket({
      createdAt: AN_HOUR_AGO,
      category: TICKET_CATEGORY.Technical,
      classifiedAt: AN_HOUR_AGO,
    });
    await seedTicket({ createdAt: AN_HOUR_AGO, classifiedAt: AN_HOUR_AGO });

    const counts = await pipelineCounts(FROM, TO, true);

    expect(counts).toMatchObject({
      received: 6,
      machineClassified: 1,
      classifyAbandoned: 1,
      classifyPending: 2,
      classifyNotOffered: {
        [CLASSIFY_NOT_OFFERED.noKey]: 0,
        [CLASSIFY_NOT_OFFERED.filedOrStale]: 2,
      },
    });
  });

  test("with no key, is never pending, and says the key is why", async () => {
    // R5: the same two tickets the classifier's rule would take, but nothing
    // will run it. They are not coming, so they are counted as not offered,
    // under the cause the rail names — the page chooses no exit itself.
    await seedTicket({ createdAt: AN_HOUR_AGO });
    await seedTicket({
      createdAt: new Date(TO.getTime() - RECONCILE_MAX_AGE_MS),
    });
    // Out of reach with or without a key, so its cause does not change.
    await seedTicket({
      createdAt: AN_HOUR_AGO,
      category: TICKET_CATEGORY.Technical,
    });

    const counts = await pipelineCounts(FROM, TO, false);

    expect(counts).toMatchObject({
      received: 3,
      classifyPending: 0,
      classifyNotOffered: {
        [CLASSIFY_NOT_OFFERED.noKey]: 2,
        [CLASSIFY_NOT_OFFERED.filedOrStale]: 1,
      },
    });
  });
});

describe("pipelineCounts — a classified ticket with no verdict", () => {
  const TO = new Date("2026-09-10T12:00:00.000Z");
  const FROM = new Date(TO.getTime() - 30 * 24 * 60 * 60 * 1_000);
  const AN_HOUR_AGO = new Date(TO.getTime() - 60 * 60 * 1_000);

  const classified = {
    createdAt: AN_HOUR_AGO,
    category: TICKET_CATEGORY.Technical,
    classifiedAt: AN_HOUR_AGO,
  };
  let replies = 0;
  /** One message on the thread, in the given direction. */
  const reply = (
    direction: (typeof MESSAGE_DIRECTION)[keyof typeof MESSAGE_DIRECTION],
    automated = false,
  ) => ({
    messages: {
      create: {
        messageId: `pipeline-counts-${++replies}@example.com`,
        senderEmail: "support@example.com",
        senderName: "Support",
        textBody: "Hold the button for ten seconds.",
        direction,
        automated,
        createdAt: AN_HOUR_AGO,
      },
    },
  });

  test("splits into still coming and never offered, reading the offer record", async () => {
    // R8. Still coming: offered, and nobody has answered. A customer's own
    // follow-up is not an answer, and a claimed ticket is being answered now.
    await seedTicket({
      ...classified,
      status: TICKET_STATUS.New,
      autoReplyOfferedAt: AN_HOUR_AGO,
      ...reply(MESSAGE_DIRECTION.inbound),
    });
    await seedTicket({
      ...classified,
      status: TICKET_STATUS.Processing,
      autoReplyOfferedAt: AN_HOUR_AGO,
      ...reply(MESSAGE_DIRECTION.outbound),
    });
    // Never offered: no record, whether or not a person answered since.
    await seedTicket({ ...classified, status: TICKET_STATUS.New });
    await seedTicket({
      ...classified,
      status: TICKET_STATUS.Open,
      ...reply(MESSAGE_DIRECTION.outbound),
    });
    // Neither — the rail's remainder: offered, then answered by hand, or
    // resolved by the machine and reopened, which clears `autoResolvedAt`.
    await seedTicket({
      ...classified,
      status: TICKET_STATUS.Open,
      autoReplyOfferedAt: AN_HOUR_AGO,
      ...reply(MESSAGE_DIRECTION.outbound),
    });
    await seedTicket({
      ...classified,
      status: TICKET_STATUS.Open,
      autoReplyOfferedAt: AN_HOUR_AGO,
      ...reply(MESSAGE_DIRECTION.outbound, true),
    });
    // Verdicts, which are neither either.
    await seedTicket({
      ...classified,
      status: TICKET_STATUS.Resolved,
      autoReplyOfferedAt: AN_HOUR_AGO,
      autoResolvedAt: AN_HOUR_AGO,
    });
    await seedTicket({
      ...classified,
      status: TICKET_STATUS.Open,
      autoReplyOfferedAt: AN_HOUR_AGO,
      autoReplyDecline: AUTO_REPLY_DECLINE.notCovered,
      autoReplyDeclinedAt: AN_HOUR_AGO,
    });
    // Unstamped, so the classifier's half, not this one.
    await seedTicket({ createdAt: AN_HOUR_AGO, status: TICKET_STATUS.New });

    const counts = await pipelineCounts(FROM, TO, true);

    expect(counts).toMatchObject({
      received: 9,
      machineClassified: 8,
      autoReplyPending: 2,
      autoReplyNotOffered: 2,
    });
  });
});

describe("GET /api/pipeline/runs/:id", () => {
  test("a ticket handed back by `onExhausted` reads as abandoned", async () => {
    // End to end through the job's own terminal path, because the claim is
    // about what that path writes and what this route makes of it — seeding the
    // columns somebody believes it writes would assert the belief instead.
    const ticket = await seedTicket({
      status: TICKET_STATUS.Processing,
      category: TICKET_CATEGORY.Technical,
      classifiedAt: CLASSIFIED_AT,
    });

    await AUTO_REPLY_WORKER.onExhausted({ ticketId: ticket.id });

    const stamped = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
      select: { autoReplyDecline: true, status: true },
    });
    expect(stamped).toMatchObject({
      autoReplyDecline: AUTO_REPLY_DECLINE.unavailable,
      status: TICKET_STATUS.Open,
    });

    const res = await fetch(url(`/runs/${ticket.id}`), { headers: ADMIN });
    const body = (await res.json()) as PipelineRunResponse;

    expect(res.status).toBe(200);
    expect(body.run.outcome).toBe(PIPELINE_OUTCOME.abandoned);
    expect(body.run.decline).toBe(AUTO_REPLY_DECLINE.unavailable);
  });

  test("a ticket the model declined still reads as declined", async () => {
    const ticket = await seedTicket({
      status: TICKET_STATUS.Open,
      category: TICKET_CATEGORY.Technical,
      classifiedAt: CLASSIFIED_AT,
      autoReplyDecline: AUTO_REPLY_DECLINE.notCovered,
      autoReplyDeclinedAt: new Date(),
    });

    const res = await fetch(url(`/runs/${ticket.id}`), { headers: ADMIN });
    const body = (await res.json()) as PipelineRunResponse;

    expect(body.run.outcome).toBe(PIPELINE_OUTCOME.declined);
  });

  describe("a ticket with no classification verdict", () => {
    // The classifier's half of the outcome, through the route and so through
    // the query that decides it — the same `classifierWillStillAct` fragment
    // the sweep and the rail's count read. Seeded against the real clock,
    // because the route reads the window at `Date.now()`.
    const ago = (ms: number) => new Date(Date.now() - ms);
    const HOUR = 60 * 60 * 1_000;

    async function outcomeOf(ticketId: number) {
      const res = await fetch(url(`/runs/${ticketId}`), { headers: ADMIN });
      expect(res.status).toBe(200);
      return ((await res.json()) as PipelineRunResponse).run.outcome;
    }

    test("unfiled and inside the reconcile window is `pending`", async () => {
      // The ingest enqueue or, failing that, the reconcile sweep is still going
      // to offer it to the classifier.
      const ticket = await seedTicket({ createdAt: ago(HOUR) });
      expect(await outcomeOf(ticket.id)).toBe(PIPELINE_OUTCOME.pending);
    });

    test("unfiled and already answered is still `pending`", async () => {
      // The classifier reads neither status nor thread, so a person replying
      // does not stop it filing the ticket — reporting this one as finished
      // would be the opposite lie.
      const ticket = await seedTicket({
        createdAt: ago(HOUR),
        status: TICKET_STATUS.Closed,
      });
      await prisma.message.create({
        data: {
          ticketId: ticket.id,
          messageId: `${ticket.id}.reply@tickets.example.com`,
          senderEmail: COLLEAGUE.admin.email,
          senderName: COLLEAGUE.admin.name,
          direction: MESSAGE_DIRECTION.outbound,
          textBody: "Sorted by hand.",
        },
      });
      expect(await outcomeOf(ticket.id)).toBe(PIPELINE_OUTCOME.pending);
    });

    test("filed by a person before the classifier got to it is `notOffered`", async () => {
      // The classify handler returns without a call when `category` is already
      // set, and the auto-reply is only ever enqueued from that handler — so
      // nothing is scheduled, however fresh and untouched the ticket. The
      // showcase seed writes this shape for every demo ticket it files.
      const ticket = await seedTicket({
        createdAt: ago(HOUR),
        category: TICKET_CATEGORY.Technical,
      });
      expect(await outcomeOf(ticket.id)).toBe(PIPELINE_OUTCOME.notOffered);
    });

    test("unfiled and older than the reconcile window is `notOffered`", async () => {
      // A job that ran would have stamped `classifiedAt` on every exit, and the
      // sweep stops looking after a day — so a ticket this old that was never
      // stamped was never offered, and nothing is going to offer it now.
      const ticket = await seedTicket({
        createdAt: ago(RECONCILE_MAX_AGE_MS + HOUR),
      });
      expect(await outcomeOf(ticket.id)).toBe(PIPELINE_OUTCOME.notOffered);
    });
  });

  test("a ticket that does not exist is a 404, not an empty run", async () => {
    const res = await fetch(url("/runs/4242"), { headers: ADMIN });
    expect(res.status).toBe(404);
  });
});
