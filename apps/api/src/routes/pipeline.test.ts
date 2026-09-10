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
 *     evidence and takes its `PipelineConfig` as a parameter, so every branch —
 *     including the two that depend on a deployment's switches — is reachable
 *     without a database or an environment.
 *   - **`GET /runs/:id` over a real socket and a real Postgres** (`../test/pg`,
 *     ADR-0014), for the one claim a value table cannot make: that a ticket
 *     *handed back by `onExhausted`* reads as `abandoned`. It runs the job's own
 *     terminal path against the real columns rather than seeding the state
 *     somebody believes that path writes.
 *
 * `GET /` is not covered here, and that is a limitation worth naming rather
 * than working around: it reads queue depth through `getBoss()`, which throws
 * with no queue started, and the seam that would answer it — `./boss` — is
 * already owned by `jobs/sweeps.test.ts` with a *stateful* factory. A second
 * factory on that specifier is the process-wide registry hazard
 * `docs/standards/testing-api.md` describes, not a tidier arrangement. What the
 * overview does with a row is `toRun(row, config)` per row, which is exactly
 * what the table below covers.
 */

import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  AUTO_REPLY_DECLINE,
  AUTO_REPLY_DECLINES,
  DECLINE_OUTCOME,
  DECLINE_STAGE,
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
    },
    session: { id: req.header("x-test-session") ?? "sess-1" },
  };
  next();
};

mock.module("../middleware/auth", () => ({
  requireAuth: fakeGuard,
  requireAdmin: fakeGuard,
  sessionOf: (res: Response) => res.locals.session,
}));

const { pipelineRouter, toRun } = await import("./pipeline");
const { AUTO_REPLY_WORKER } = await import("../jobs/auto-reply-ticket");

type RunRow = Parameters<typeof toRun>[0];

/* ── The rows and the deployment ─────────────────────────────────────────── */

const CREATED_AT = new Date("2026-09-01T09:00:00.000Z");
const CLASSIFIED_AT = new Date("2026-09-01T09:00:12.000Z");

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
    createdAt: CREATED_AT,
    messages: [],
    ...overrides,
  };
}

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
      expect(toRun(declinedRow(decline), LIVE).outcome).toBe(
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
    const run = toRun(declinedRow(AUTO_REPLY_DECLINE.unavailable), LIVE);

    expect(run.outcome).toBe(PIPELINE_OUTCOME.abandoned);
    expect(run.decline).toBe(AUTO_REPLY_DECLINE.unavailable);
  });

  test("the nine verdicts are still `declined`", () => {
    // The other half of the same claim: the fix narrows one member and leaves
    // every real decline alone.
    for (const decline of AUTO_REPLY_DECLINES) {
      if (decline === AUTO_REPLY_DECLINE.unavailable) continue;
      expect(toRun(declinedRow(decline), LIVE).outcome).toBe(
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
      const run = toRun(declinedRow(decline), LIVE);
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
    const run = toRun(declinedRow(AUTO_REPLY_DECLINE.unavailable), LIVE);
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
    );

    expect(run.outcome).toBe(PIPELINE_OUTCOME.resolved);
    expect(run.citedArticleIds).toEqual(["KB-001"]);
  });

  test("the classifier out of retries is `abandoned` too, with no reason", () => {
    // The other road to `abandoned`, and the reason its wording has to be true
    // of more than one thing: a stamped `classifiedAt` with no category is the
    // classifier's terminal path, which never reached the auto-reply at all.
    const run = toRun(row({ category: null }), LIVE);

    expect(run.outcome).toBe(PIPELINE_OUTCOME.abandoned);
    expect(run.decline).toBeNull();
  });

  test("waiting on a stage that will run is `pending`", () => {
    const run = toRun(row({ status: TICKET_STATUS.New }), LIVE);
    expect(run.outcome).toBe(PIPELINE_OUTCOME.pending);
  });

  test("waiting on a stage nothing will run is `notOffered`", () => {
    // An empty corpus reached *before* the ticket is enqueued: nothing is
    // scheduled, which is a different true statement from "this one was tried
    // and got nowhere" (ADR-0019). The two must not be collapsed.
    const run = toRun(row({ status: TICKET_STATUS.New }), {
      ...LIVE,
      autoReplyArticleCount: 0,
    });
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

  test("a ticket that does not exist is a 404, not an empty run", async () => {
    const res = await fetch(url("/runs/4242"), { headers: ADMIN });
    expect(res.status).toBe(404);
  });
});
