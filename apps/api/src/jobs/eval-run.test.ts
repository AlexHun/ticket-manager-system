/**
 * Unit tests for `apps/api/src/jobs/eval-run.ts`.
 *
 * The storing half of the eval harness: `EVAL_RUN_WORKER.handle` answering a
 * set of cases and writing what it found, and `onExhausted` closing a run the
 * ladder gave up on. Both are reached as function calls because the spec is
 * exported, which is what makes the terminal path testable at all — it
 * otherwise never runs on a good day (`backend.md`, #154).
 *
 * `../evals/runner` is stubbed, so what is under test is the bookkeeping: the
 * expectations copied onto each row, the aggregates rolled onto the run, the
 * three idempotency guards, and the per-case event. The translation it stands
 * in for has its own file next to it.
 *
 * The database is real (`../test/pg`, ADR-0014), which is what lets the
 * "delivered twice" tests mean something: two of the three guards are a
 * conditional `updateMany` and a unique index, and a fake client could only
 * report that it was called with the right `where`.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  AUTO_REPLY_DECLINE,
  EVAL_CORPUS,
  EVAL_RUN_STATUS,
  PIPELINE_OUTCOME,
  TICKET_CATEGORY,
  TICKET_EVENT,
  type TicketEvent,
} from "@ticket/shared";
import { prisma, resetDb } from "../test/pg";
import { subscribe } from "../events/hub";
import type { EvalCaseOutcome } from "../evals/runner";
import { parseStoredVerdicts } from "../evals/stored-verdict";

/* ── The measuring half, replaced ────────────────────────────────────────── */

/** A case that landed where it said it would, every repeat. */
function cleanRun(repeats: number): EvalCaseOutcome {
  return {
    verdicts: Array.from({ length: repeats }, () => ({
      outcome: PIPELINE_OUTCOME.declined,
      decline: AUTO_REPLY_DECLINE.notCovered,
      matched: true,
      usd: 0.0002,
      cached: true,
      caught: false,
      escaped: false,
      category: TICKET_CATEGORY.General,
      classifyMatched: true,
    })),
    repeats,
    matches: repeats,
    abandoned: 0,
    usd: 0.0002 * repeats,
    // Both halves of the cache rate, because `runCase` emits both: the first
    // repeat warms it, so it is a hit on none of them and countable on all the
    // rest. This file is not where that rule is asserted (`evals/runner.test.ts`
    // is) — it is the fixture agreeing with it.
    cachedRepeats: repeats - 1,
    cacheable: repeats - 1,
    caught: 0,
    escaped: 0,
    classifiedRepeats: repeats,
    classifyMatches: repeats,
  };
}

/**
 * A case the classifier filed somewhere else on the last repeat.
 *
 * Built off `cleanRun` and kept in step with it the same way `payloadRun` is:
 * the run's aggregate is summed from the rows, so a fixture whose totals
 * disagreed with its own verdicts would be testing a state nothing can reach.
 */
function misfiledRun(repeats: number): EvalCaseOutcome {
  const clean = cleanRun(repeats);
  const verdicts = clean.verdicts.map((verdict, index) =>
    index === repeats - 1
      ? { ...verdict, category: TICKET_CATEGORY.Other, classifyMatched: false }
      : verdict,
  );

  return {
    ...clean,
    verdicts,
    classifiedRepeats: verdicts.filter((v) => v.category !== null).length,
    classifyMatches: verdicts.filter((v) => v.classifyMatched).length,
  };
}

/**
 * A payload the checks stopped every time but the last, which got out.
 *
 * The per-repeat flags and the totals are built together rather than stated
 * twice: the run's aggregate is summed from the rows and the per-check
 * breakdown is read from the array, so a fixture where the two disagreed would
 * be testing a state the runner cannot produce.
 */
function payloadRun(repeats: number): EvalCaseOutcome {
  const clean = cleanRun(repeats);
  const verdicts = clean.verdicts.map((verdict, index) => ({
    ...verdict,
    caught: index < repeats - 1,
    escaped: index === repeats - 1,
  }));

  return {
    ...clean,
    verdicts,
    caught: verdicts.filter((v) => v.caught).length,
    escaped: verdicts.filter((v) => v.escaped).length,
  };
}

let nextOutcome: (repeats: number) => EvalCaseOutcome = cleanRun;

/** Every case the runner was asked to answer, and with how many repeats. */
let answered: { caseId: string; repeats: number }[] = [];
/** The corpus the runner was handed, so the R4 fork can be asserted. */
let lastArticles: unknown;

// Spread, for the reason the note in `routes/evals.test.ts` records at length:
// a factory that does not spread the real module *is* that module for every
// file that loads it afterwards. Nothing depends on this one today —
// `evals/runner.test.ts` destructures while loading, so it holds the real
// functions whatever is registered later — but "nothing depends on it today" is
// how the other one got written, and it cost a red CI run.
const runnerModule = await import("../evals/runner");

mock.module("../evals/runner", () => ({
  ...runnerModule,
  runCase: async (
    articles: unknown,
    evalCase: { id: string },
    repeats: number,
  ) => {
    lastArticles = articles;
    answered.push({ caseId: evalCase.id, repeats });
    return nextOutcome(repeats);
  },
}));

const { EVAL_RUN_WORKER, ALL_EVAL_CASE_IDS } = await import("./eval-run");

/* ── Fixtures ────────────────────────────────────────────────────────────── */

const REPEATS = 5;

/** Two cases, both reached by every test that is not about the whole set. */
const PAIR = ["off-corpus", "refund"];

async function newRun(
  corpus: (typeof EVAL_CORPUS)[keyof typeof EVAL_CORPUS] = EVAL_CORPUS.frozen,
): Promise<number> {
  const run = await prisma.evalRun.create({
    data: { corpus, repeats: REPEATS },
  });
  return run.id;
}

/** Every event a subscriber heard, and the unsubscribe to call afterwards. */
function collect(): { heard: TicketEvent[]; stop: () => void } {
  const heard: TicketEvent[] = [];
  const stop = subscribe({
    role: "admin",
    send: (event) => heard.push(event),
    close: () => {},
  });
  return { heard, stop };
}

beforeEach(async () => {
  await resetDb();
  answered = [];
  lastArticles = undefined;
  nextOutcome = cleanRun;
});

/* ── The happy path ──────────────────────────────────────────────────────── */

describe("handle", () => {
  test("answers every case it was given and closes the run", async () => {
    const runId = await newRun();

    await EVAL_RUN_WORKER.handle({
      runId,
      corpus: EVAL_CORPUS.frozen,
      caseIds: PAIR,
    });

    const run = await prisma.evalRun.findUniqueOrThrow({
      where: { id: runId },
      include: { results: true },
    });

    expect(run.status).toBe(EVAL_RUN_STATUS.completed);
    expect(run.finishedAt).not.toBeNull();
    expect(run.results.map((r) => r.caseId).sort()).toEqual([...PAIR].sort());
  });

  test("answers each case as many times as the run says, and stores a rate", async () => {
    // R3. One answer from a model is a coin toss reported as a fact; the row
    // has to carry matches out of repeats, never a boolean.
    const runId = await newRun();

    await EVAL_RUN_WORKER.handle({
      runId,
      corpus: EVAL_CORPUS.frozen,
      caseIds: ["off-corpus"],
    });

    expect(answered).toEqual([{ caseId: "off-corpus", repeats: REPEATS }]);
    const result = await prisma.evalCaseResult.findFirstOrThrow({
      where: { runId },
    });
    expect(result.repeats).toBe(REPEATS);
    expect(result.matches).toBe(REPEATS);
    expect(result.verdicts).toHaveLength(REPEATS);
  });

  test("rolls the case counts up onto the run", async () => {
    const runId = await newRun();

    await EVAL_RUN_WORKER.handle({
      runId,
      corpus: EVAL_CORPUS.frozen,
      caseIds: PAIR,
    });

    const run = await prisma.evalRun.findUniqueOrThrow({
      where: { id: runId },
    });
    expect(run.attempts).toBe(PAIR.length * REPEATS);
    expect(run.matches).toBe(PAIR.length * REPEATS);
    expect(run.abandoned).toBe(0);
    // R10: an estimate, recorded rather than only logged.
    expect(run.usd).toBeCloseTo(PAIR.length * REPEATS * 0.0002, 6);
    // One repeat per case is what warms the cache and can never be a hit.
    expect(run.cachedRepeats).toBe(PAIR.length * (REPEATS - 1));
  });

  test("records what each case's payload did, and rolls that up too", async () => {
    // R9. The catch rate is aggregated apart from decline accuracy all the way
    // down: per case on the row, per run on the totals. A single blended number
    // would let a good week on one hide a regression on the other, which is the
    // failure this harness exists to prevent rather than to commit.
    nextOutcome = payloadRun;
    const runId = await newRun();

    await EVAL_RUN_WORKER.handle({
      runId,
      corpus: EVAL_CORPUS.frozen,
      caseIds: PAIR,
    });

    const run = await prisma.evalRun.findUniqueOrThrow({
      where: { id: runId },
      include: { results: true },
    });

    for (const result of run.results) {
      expect(result.caught).toBe(REPEATS - 1);
      expect(result.escaped).toBe(1);
    }
    expect(run.caught).toBe(PAIR.length * (REPEATS - 1));
    expect(run.escaped).toBe(PAIR.length);
  });

  test("keeps each repeat's own catch verdict, which is what names the check", async () => {
    // The per-check breakdown (R9) is read out of this array — nothing joins on
    // it — so a repeat that says only "caught" would not be able to say whether
    // the money check or the reference check was the one that held.
    nextOutcome = payloadRun;
    const runId = await newRun();

    await EVAL_RUN_WORKER.handle({
      runId,
      corpus: EVAL_CORPUS.frozen,
      caseIds: ["off-corpus"],
    });

    const result = await prisma.evalCaseResult.findFirstOrThrow({
      where: { runId },
    });
    // Through the parse the read model uses, not a cast: the column is `Json`
    // and `evals/stored-verdict.ts` is the one place that says what is in it.
    const verdicts = parseStoredVerdicts(result.verdicts);
    expect(verdicts.filter((v) => v.caught)).toHaveLength(REPEATS - 1);
  });

  test("copies the expectation onto the row rather than pointing at the case", async () => {
    // The case set is edited by hand, so a run from three weeks ago has to keep
    // saying what *it* was measured against. A row that re-derived its own
    // expectation would silently agree with whatever the file says today, which
    // is the drift a stored result exists to make visible.
    const runId = await newRun();

    await EVAL_RUN_WORKER.handle({
      runId,
      corpus: EVAL_CORPUS.frozen,
      caseIds: ["off-corpus"],
    });

    const result = await prisma.evalCaseResult.findFirstOrThrow({
      where: { runId },
    });
    expect(result.expectedOutcome).toBe(PIPELINE_OUTCOME.declined);
    expect(result.expectedDecline).toBe(AUTO_REPLY_DECLINE.notCovered);
    expect(result.caseName).toBe("Nothing in the corpus covers it");
    expect(result.adversarial).toBe(false);
    // The classifier's expectation too, and for the same reason.
    expect(result.expectedCategory).toBe(TICKET_CATEGORY.General);
  });

  test("leaves the expected category null on a case the classifier is not scored on", async () => {
    // `unclassified` expects classification to have *failed*, so there is
    // nothing to score and nothing to write down. A row that carried an
    // expectation here would read as "0 of 0 filed as General", which claims a
    // measurement that never happened.
    const runId = await newRun();

    await EVAL_RUN_WORKER.handle({
      runId,
      corpus: EVAL_CORPUS.frozen,
      caseIds: ["unclassified"],
    });

    const result = await prisma.evalCaseResult.findFirstOrThrow({
      where: { runId },
    });
    expect(result.expectedCategory).toBeNull();
  });

  test("records what the classifier did, and rolls that up onto the run too", async () => {
    // R15. The per-repeat category is on the stored verdicts as well as in the
    // totals, because "what was filed where" is read out of the array — a bare
    // 4-of-5 cannot say *which* category the fifth one went to.
    nextOutcome = misfiledRun;
    const runId = await newRun();

    await EVAL_RUN_WORKER.handle({
      runId,
      corpus: EVAL_CORPUS.frozen,
      caseIds: ["off-corpus"],
    });

    const result = await prisma.evalCaseResult.findFirstOrThrow({
      where: { runId },
    });
    expect(result.classifiedRepeats).toBe(REPEATS);
    expect(result.classifyMatches).toBe(REPEATS - 1);
    expect(parseStoredVerdicts(result.verdicts).map((v) => v.category)).toEqual(
      [
        TICKET_CATEGORY.General,
        TICKET_CATEGORY.General,
        TICKET_CATEGORY.General,
        TICKET_CATEGORY.General,
        TICKET_CATEGORY.Other,
      ],
    );

    const run = await prisma.evalRun.findUniqueOrThrow({
      where: { id: runId },
    });
    expect(run.classifiedRepeats).toBe(REPEATS);
    expect(run.classifyMatches).toBe(REPEATS - 1);
  });

  test("records misses without failing the run", async () => {
    // A case landing somewhere unexpected is the answer, not an error. A run
    // that went red because a metric moved would be a run nobody could read.
    nextOutcome = (repeats) => ({
      ...cleanRun(repeats),
      matches: 2,
      verdicts: Array.from({ length: repeats }, () => ({
        outcome: PIPELINE_OUTCOME.resolved,
        decline: null,
        matched: false,
        usd: 0.0002,
        cached: true,
        caught: false,
        escaped: false,
        category: TICKET_CATEGORY.General,
        classifyMatched: true,
      })),
    });
    const runId = await newRun();

    await EVAL_RUN_WORKER.handle({
      runId,
      corpus: EVAL_CORPUS.frozen,
      caseIds: ["off-corpus"],
    });

    const run = await prisma.evalRun.findUniqueOrThrow({
      where: { id: runId },
    });
    expect(run.status).toBe(EVAL_RUN_STATUS.completed);
    expect(run.error).toBeNull();
    expect(run.matches).toBe(2);
    expect(run.attempts).toBe(REPEATS);
  });

  test("keeps unanswered repeats out of the matches and counts them apart", async () => {
    // An outage is not the model getting things wrong. A harness that cannot
    // tell them apart is the one that cries wolf and then gets ignored.
    nextOutcome = (repeats) => ({
      ...cleanRun(repeats),
      matches: 0,
      abandoned: repeats,
      usd: 0,
      cachedRepeats: 0,
    });
    const runId = await newRun();

    await EVAL_RUN_WORKER.handle({
      runId,
      corpus: EVAL_CORPUS.frozen,
      caseIds: ["off-corpus"],
    });

    const run = await prisma.evalRun.findUniqueOrThrow({
      where: { id: runId },
    });
    expect(run.abandoned).toBe(REPEATS);
    expect(run.matches).toBe(0);
    expect(run.status).toBe(EVAL_RUN_STATUS.completed);
  });

  test("announces each case as it finishes, and the run at the end", async () => {
    // R5's second half: an admin watches a run fill in rather than staring at a
    // spinner for several minutes with no way to tell it from a wedged one.
    const { heard, stop } = collect();
    const runId = await newRun();

    try {
      await EVAL_RUN_WORKER.handle({
        runId,
        corpus: EVAL_CORPUS.frozen,
        caseIds: PAIR,
      });
    } finally {
      stop();
    }

    expect(heard).toHaveLength(PAIR.length + 1);
    expect(heard.every((e) => e.kind === TICKET_EVENT.eval_run_changed)).toBe(
      true,
    );
    expect(heard.map((e) => (e as { runId: number }).runId)).toEqual([
      runId,
      runId,
      runId,
    ]);
  });

  test("answers the whole set when the route pinned nothing", async () => {
    const runId = await newRun();

    await EVAL_RUN_WORKER.handle({
      runId,
      corpus: EVAL_CORPUS.frozen,
      caseIds: ALL_EVAL_CASE_IDS,
    });

    expect(answered).toHaveLength(ALL_EVAL_CASE_IDS.length);
    // R2's floor, asserted where it can actually be broken by an edit.
    expect(ALL_EVAL_CASE_IDS.length).toBeGreaterThanOrEqual(30);
  });
});

/* ── Which knowledge base answered (R4) ──────────────────────────────────── */

/**
 * One article in the table, so a live run has something distinguishable to read.
 *
 * A real row rather than a stub for `../ai/knowledge-base`, and that is a
 * registry decision rather than a preference: `ai/knowledge-base.test.ts` tests
 * that module and imports it, so a factory registered here would be the module
 * it links if this file happened to load first — green on Windows, red on
 * `ubuntu-latest`, which is exactly the file-order trap `testing.md` records.
 * `../db` is already bound to the in-process Postgres by the preload, so a row
 * is both cheaper and closer to the thing under test.
 */
async function seedLiveArticle(): Promise<void> {
  await prisma.knowledgeArticle.create({
    data: {
      id: "KB-LIVE",
      title: "Only in the table",
      category: "General",
      body: "This article exists in the database and not in the seed file.",
      autoReply: true,
    },
  });
}

describe("the corpus", () => {
  test("a frozen run reads the seed file", async () => {
    await seedLiveArticle();
    const runId = await newRun();

    await EVAL_RUN_WORKER.handle({
      runId,
      corpus: EVAL_CORPUS.frozen,
      caseIds: ["off-corpus"],
    });

    // The seed file, not the article table — and asserted by its contents
    // rather than by which function was called, because the point is that a
    // frozen run's numbers cannot move when somebody edits an article. The row
    // seeded above is in the table and must not be in this prompt.
    const articles = lastArticles as { id: string }[];
    expect(articles.length).toBeGreaterThan(0);
    expect(articles.some((a) => a.id === "KB-LIVE")).toBe(false);
  });

  test("a live run reads the articles table", async () => {
    await seedLiveArticle();
    const runId = await newRun(EVAL_CORPUS.live);

    await EVAL_RUN_WORKER.handle({
      runId,
      corpus: EVAL_CORPUS.live,
      caseIds: ["off-corpus"],
    });

    // Through `autoReplyArticles()` itself, so the two structural filters come
    // with it: a withheld article is absent and `internalNote` is never
    // selected. A run must not measure a prompt the desk would never build.
    expect(lastArticles).toEqual([
      {
        id: "KB-LIVE",
        title: "Only in the table",
        category: "General",
        body: "This article exists in the database and not in the seed file.",
      },
    ]);
  });

  test("a live run leaves a withheld article out, exactly as the desk does", async () => {
    // The flag is the first gate on the whole feature and it lives in content,
    // not in code. A harness that measured a corpus assembled any other way
    // would be measuring a prompt that never gets built.
    await prisma.knowledgeArticle.create({
      data: {
        id: "KB-WITHHELD",
        title: "A person answers this one",
        category: "Refund",
        body: "Not for a machine.",
        autoReply: false,
      },
    });
    const runId = await newRun(EVAL_CORPUS.live);

    await EVAL_RUN_WORKER.handle({
      runId,
      corpus: EVAL_CORPUS.live,
      caseIds: ["off-corpus"],
    });

    expect(lastArticles).toEqual([]);
  });
});

/* ── At-least-once delivery ──────────────────────────────────────────────── */

describe("a job delivered twice", () => {
  test("finishes the run once and writes one result per case", async () => {
    const runId = await newRun();
    const job = { runId, corpus: EVAL_CORPUS.frozen, caseIds: PAIR };

    await EVAL_RUN_WORKER.handle(job);
    await EVAL_RUN_WORKER.handle(job);

    expect(await prisma.evalCaseResult.count({ where: { runId } })).toBe(
      PAIR.length,
    );
  });

  test("does not pay for a second set of model calls", async () => {
    // The re-read is above everything: an eval is the one feature whose whole
    // cost is model calls, and a duplicate delivery that answers the set again
    // before discovering it has nothing to write is a bill.
    const runId = await newRun();
    const job = { runId, corpus: EVAL_CORPUS.frozen, caseIds: PAIR };

    await EVAL_RUN_WORKER.handle(job);
    await EVAL_RUN_WORKER.handle(job);

    expect(answered).toHaveLength(PAIR.length);
  });

  test("a delivery arriving mid-run resumes rather than starting again", async () => {
    // pg-boss re-offers an expired job, and a run is minutes long. The cases
    // already answered are already paid for; answering them twice would both
    // cost again and double them in the rates taken off these rows.
    const runId = await newRun();
    await prisma.evalCaseResult.create({
      data: {
        runId,
        caseId: "refund",
        caseName: "Refund request",
        adversarial: false,
        expectedOutcome: PIPELINE_OUTCOME.declined,
        expectedDecline: AUTO_REPLY_DECLINE.category,
        repeats: REPEATS,
        matches: REPEATS,
        verdicts: [],
      },
    });

    await EVAL_RUN_WORKER.handle({
      runId,
      corpus: EVAL_CORPUS.frozen,
      caseIds: PAIR,
    });

    expect(answered).toEqual([{ caseId: "off-corpus", repeats: REPEATS }]);
    // The totals still cover the whole run, not just this attempt's share.
    const run = await prisma.evalRun.findUniqueOrThrow({
      where: { id: runId },
    });
    expect(run.attempts).toBe(PAIR.length * REPEATS);
  });

  test("a run that has vanished is not an error", async () => {
    // A row deleted between the last attempt and this delivery must not fail
    // the job and send it round the ladder again.
    await expect(
      EVAL_RUN_WORKER.handle({
        runId: 9999,
        corpus: EVAL_CORPUS.frozen,
        caseIds: PAIR,
      }),
    ).resolves.toBeUndefined();
  });
});

/* ── The terminal path ───────────────────────────────────────────────────── */

describe("onExhausted", () => {
  test("closes the run as failed and says so on the row", async () => {
    // Otherwise a run sits at "running" forever on a page whose whole job is
    // saying what happened — indistinguishable from a job still in flight.
    const runId = await newRun();

    await EVAL_RUN_WORKER.onExhausted({
      runId,
      corpus: EVAL_CORPUS.frozen,
      caseIds: PAIR,
    });

    const run = await prisma.evalRun.findUniqueOrThrow({
      where: { id: runId },
    });
    expect(run.status).toBe(EVAL_RUN_STATUS.failed);
    expect(run.finishedAt).not.toBeNull();
    expect(run.error).toBeTruthy();
  });

  test("leaves the cases it did manage where they are", async () => {
    // They were measured and they are true. The `failed` status is what says
    // the run covers less than a whole set.
    const runId = await newRun();
    await EVAL_RUN_WORKER.handle({
      runId,
      corpus: EVAL_CORPUS.frozen,
      caseIds: ["off-corpus"],
    });

    await EVAL_RUN_WORKER.onExhausted({
      runId,
      corpus: EVAL_CORPUS.frozen,
      caseIds: PAIR,
    });

    expect(await prisma.evalCaseResult.count({ where: { runId } })).toBe(1);
  });

  test("leaves a run that already finished alone", async () => {
    const runId = await newRun();
    await EVAL_RUN_WORKER.handle({
      runId,
      corpus: EVAL_CORPUS.frozen,
      caseIds: PAIR,
    });

    await EVAL_RUN_WORKER.onExhausted({
      runId,
      corpus: EVAL_CORPUS.frozen,
      caseIds: PAIR,
    });

    const run = await prisma.evalRun.findUniqueOrThrow({
      where: { id: runId },
    });
    expect(run.status).toBe(EVAL_RUN_STATUS.completed);
  });
});

/* ── Ids nothing names ───────────────────────────────────────────────────── */

test("a case set the code no longer carries fails the run rather than the job", async () => {
  // The case set is code and the ids on the job are strings that outlived a
  // rename. Retrying cannot help, so this settles the run instead of climbing
  // the ladder to say the same thing five times.
  const runId = await newRun();

  await EVAL_RUN_WORKER.handle({
    runId,
    corpus: EVAL_CORPUS.frozen,
    caseIds: ["no-such-case"],
  });

  const run = await prisma.evalRun.findUniqueOrThrow({ where: { id: runId } });
  expect(run.status).toBe(EVAL_RUN_STATUS.failed);
  expect(run.error).toContain("no-such-case");
  expect(answered).toEqual([]);
});
