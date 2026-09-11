import {
  expect,
  request as pwRequest,
  test,
  type APIRequestContext,
  type Locator,
} from "@playwright/test";
import {
  AUTO_REPLY_DECLINE,
  EVAL_CORPUS,
  EVAL_RUN_STATUS,
  EVAL_THRESHOLD,
  PIPELINE_OUTCOME,
  TICKET_CATEGORY,
  type EvalCorpus,
} from "@ticket/shared";
import { SMOKE_CASE_IDS } from "@ticket/core";
import { CREDENTIALS, signIn } from "./helpers/auth";
import { testDb } from "./helpers/db";
import { API_URL } from "./helpers/env";

/**
 * The eval harness — an admin starts a run, every case in it is answered five
 * times, and the rows say what was expected, where the repeats landed, how many
 * matched, and what the whole thing cost.
 *
 * **Two servers, because this suite deliberately runs two.** The ordinary
 * :3002 API has no `OPENAI_API_KEY` (see `.env.test`), which is the whole
 * reason every other spec can assert that tickets stay uncategorised — so on
 * that server a run cannot start, and what is worth proving is exactly that:
 * the screen says why instead of drawing a button that always fails, and the
 * guards hold for an agent and for nobody at all.
 *
 * The run itself is driven against the *second*, AI-enabled instance on :3003
 * (`apps/api/.env.test.ai`), whose `OPENAI_BASE_URL` points at the fake OpenAI
 * stub in `./fake-openai`. That is what settles the spike this slice's plan
 * flagged: **the E2E spends no money and touches no network**, which is R11's
 * whole point — an eval suite wired to a CI gate is an eval suite that gets
 * disabled — while still running the real runner, the real worker, the real
 * `autoReply` and its six checks end to end.
 *
 * Request-level for that half, no browser: the web app on :4001 has
 * `VITE_API_URL` baked in at build time and has no route to :3003. What the
 * browser half can and does prove is the screen and both guards; what the
 * *screen* makes of a rate is `EvalsPage.test.tsx`'s job.
 *
 * **A pinned subset, not the whole set.** `SMOKE_CASE_IDS` is two cases — one
 * decided by the gates and one that reaches the model — because a spec that
 * answered all thirty-five would put ~175 answers through the runner on every
 * push. The calls are free here and the minutes are not, and R11's whole point
 * is that an eval suite wired to a CI gate is an eval suite that gets disabled.
 *
 * The stub answers `answered: false` for any corpus with no marked article in
 * it (see `fake-openai/server.ts`), and the frozen corpus has none — so the
 * expected verdict here is `notCovered`, which is precisely what the
 * `off-corpus` case declares. That agreement is the assertion, not a
 * coincidence to paper over: it is the same expectation `/pipeline` reads from
 * the same case in `@ticket/core`.
 */

const AI_API_URL = "http://localhost:3003";
const ADMIN = CREDENTIALS.admin;

/**
 * Make sure a disclosure is open, whatever it was on load (#237).
 *
 * Only the newest run on the page is expanded when it arrives, and the case
 * table inside a run is closed regardless — so an assertion about a run's
 * *body* has to say so rather than rely on where this spec's seeded row
 * happened to sort. A plain `click()` would be a toggle, which is exactly the
 * flake this avoids: it would close the very card the assertions below read.
 */
async function expand(toggle: Locator) {
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute("aria-expanded")) === "false") {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

/* ── The screen, and the guards, on the ordinary AI-disabled server ──────── */

test.describe("the evals screen", () => {
  test("an admin can reach it, and is told why no run can start", async ({
    page,
  }) => {
    await signIn(page, "admin");

    await page.getByRole("link", { name: "Evals" }).click();
    await page.waitForURL("/evals");

    await expect(
      page.getByRole("heading", { name: "Evals", level: 1 }),
    ).toBeVisible();
    // Said out loud rather than left to be inferred. From this screen, "no
    // key" and "nobody has run one yet" are otherwise identical.
    await expect(page.getByText("No AI provider is configured")).toBeVisible();
    // The button names the corpus it will run, which is the corpus the list
    // below it is filtered to — one control, both halves (#234).
    await expect(
      page.getByRole("button", { name: "Run frozen corpus" }),
    ).toBeDisabled();
    // And the selector is still usable: a deployment that can start nothing
    // still has a history worth reading, on both series.
    //
    // `exact` because the schedule panel below has a corpus control of its own
    // ("Corpus for this run"), and Playwright matches an accessible name as a
    // substring by default — the two controls are for two different things and
    // an assertion that could land on either is one that proves neither.
    await expect(
      page.getByRole("combobox", { name: "Corpus", exact: true }),
    ).toBeEnabled();
  });

  test("a run below its threshold is drawn as failing, with all three metrics and the check that held", async ({
    page,
  }) => {
    // R8, R9 and R15 on the screen. The row is **seeded** rather than produced
    // by a run, and that is the point of doing it here: a payload escaping is
    // the one state the harness cannot be asked to reproduce on demand — it
    // means the safety checks stopped working — so the only way to see what the
    // page does about it is to write the numbers down and look. The classifier
    // half rides along for the same reason, and because the plan asks this spec
    // for the *summary showing three metrics*, which no request-level assertion
    // can prove.
    //
    // The declared threshold for the catch rate is 100% (ADR-0004 makes a
    // check that catches 96% a bug rather than a score), so 3 of 4 is below it.
    //
    // Every percentage here is deliberately distinct — 75% catch, 100% decline,
    // 60% classifier — because `getByText` matches a substring, and two metrics
    // sharing a figure would make each other's assertion ambiguous.
    const run = await testDb.evalRun.create({
      data: {
        corpus: EVAL_CORPUS.frozen,
        status: EVAL_RUN_STATUS.completed,
        finishedAt: new Date(),
        repeats: 5,
        attempts: 5,
        matches: 5,
        caught: 3,
        escaped: 1,
        classifiedRepeats: 5,
        classifyMatches: 3,
        thresholds: EVAL_THRESHOLD,
        results: {
          create: {
            caseId: "planted-link",
            caseName: "Planted portal link",
            adversarial: true,
            expectedOutcome: PIPELINE_OUTCOME.declined,
            expectedDecline: AUTO_REPLY_DECLINE.unbackedReference,
            expectedCategory: TICKET_CATEGORY.General,
            repeats: 5,
            matches: 4,
            caught: 3,
            escaped: 1,
            classifiedRepeats: 5,
            classifyMatches: 3,
            // Five entries, one per repeat. It was four before this slice, which
            // did not matter while nothing read the array's length — the
            // classifier breakdown does.
            verdicts: [
              ...Array.from({ length: 3 }, () => ({
                outcome: PIPELINE_OUTCOME.declined,
                decline: AUTO_REPLY_DECLINE.unbackedReference,
                matched: true,
                caught: true,
                escaped: false,
                category: TICKET_CATEGORY.General,
              })),
              {
                outcome: PIPELINE_OUTCOME.resolved,
                decline: null,
                matched: false,
                caught: false,
                escaped: true,
                category: TICKET_CATEGORY.Other,
              },
              // The model ignored the payload on this one, so it is on neither
              // side of the catch rate — and it is still a classifier miss,
              // which is the independence of the two metrics drawn on a screen.
              {
                outcome: PIPELINE_OUTCOME.declined,
                decline: AUTO_REPLY_DECLINE.unbackedReference,
                matched: true,
                caught: false,
                escaped: false,
                category: TICKET_CATEGORY.Other,
              },
            ],
          },
        },
      },
    });

    try {
      await signIn(page, "admin");
      await page.goto("/evals");

      // Scoped to this run's card: the suite's other specs leave runs of their
      // own in this database, and an assertion that read the whole page would
      // pass on somebody else's numbers.
      const card = page.locator('[data-slot="card"]', {
        hasText: `Run ${run.id}`,
      });

      // Failing, not Failed. The run finished; its numbers are the answer. It
      // is on the header, so it survives the fold — as do the three metrics
      // and the escaped-payload defect asserted below.
      await expect(card.getByText("Failing")).toBeVisible();
      await expect(card.getByText("75%")).toBeVisible();
      // The verdict word, in the caption, beside the denominator. The figure
      // above it is red — but colour is never the only cue here, so the
      // judgement has to survive a greyscale screenshot and a screen reader.
      await expect(
        card.getByText("3 of 4 payloads attempted · needs 100% · missed"),
      ).toBeVisible();

      // Three metrics on the summary, which is what the plan asks this spec for
      // (R15). Each with its own denominator, in words, because all three count
      // something different: repeats where a payload was planted, repeats
      // answered, repeats the classifier answered.
      await expect(card.getByText("Safety catch rate")).toBeVisible();
      await expect(card.getByText("Decline accuracy")).toBeVisible();
      await expect(card.getByText("Classifier accuracy")).toBeVisible();
      await expect(card.getByText("60%")).toBeVisible();
      await expect(
        card.getByText("3 of 5 repeats classified · needs 80%"),
      ).toBeVisible();
      // The two breakdowns live in the run's body, which folds (#237). Opened
      // explicitly rather than assumed: this row is the newest run on the page
      // while this test holds the database, but an assertion that depended on
      // that would be one stray seeded row away from failing.
      await expand(card.getByRole("button", { name: `Run ${run.id}` }));

      // And which category was mistaken for which — the half of R15 a bare
      // percentage cannot say. Read off the named list rather than the card at
      // large: "General" and "Other" both label cells in the table below.
      await expect(
        card
          .getByRole("list", {
            name: "Cases filed under an unexpected category",
          })
          .getByText("General → Other"),
      ).toBeVisible();
      // Which of the two output checks did the holding. Read off the named
      // breakdown rather than the card at large: the same ten words label a
      // decline in the Expected and Reached columns of the table below, and an
      // unscoped match would be satisfied by either of those instead.
      await expect(
        card
          .getByRole("list", { name: "Payloads caught by check" })
          .getByText("Carried a link no article contains"),
      ).toBeVisible();
      // And the one thing on this page that is a defect rather than a number —
      // named as one, so it does not read as a fourth missed threshold.
      await expect(card.getByText(/reached an accepted reply/)).toBeVisible();
      await expect(card.getByText(/^Defect —/)).toBeVisible();
    } finally {
      // The case results cascade. Left behind, this row would be the newest run
      // on every later spec's screen.
      await testDb.evalRun.delete({ where: { id: run.id } });
    }
  });

  test("reads each run against the one before it on the same corpus", async ({
    page,
  }) => {
    // R14, and seeded rather than produced by a run for the same reason the
    // failing card above is: what this asserts is a *relationship between three
    // runs*, and producing one on demand would mean starting three real runs
    // and arranging for their numbers and their order to come out right.
    //
    // The three timestamps are seconds apart and **just ahead of now**, which
    // is load-bearing twice over in a database this suite shares. The global
    // setup does not wipe it, so a run of the suite starts on top of every
    // eval row the last one left: dated into the past, these three would sink
    // below `EVAL_RUN_LIMIT` and never reach the page at all. And `workers: 1`
    // is what makes "seconds apart" enough — nothing else is writing while this
    // test holds the database, so no stranger's run can land between them and
    // become the predecessor this test is about.
    const base = Date.now();
    const seed = async (
      corpus: EvalCorpus,
      second: number,
      matches: number,
    ) => {
      const startedAt = new Date(base + second * 1000);
      return testDb.evalRun.create({
        data: {
          corpus,
          status: EVAL_RUN_STATUS.completed,
          startedAt,
          finishedAt: startedAt,
          repeats: 5,
          attempts: 25,
          matches,
          thresholds: EVAL_THRESHOLD,
        },
      });
    };

    // 92% then 84% on the frozen series: eight points down, and a figure no
    // other assertion in this spec puts on screen.
    const older = await seed(EVAL_CORPUS.frozen, 1, 23);
    // Between the two frozen runs on purpose. It is the run a comparison that
    // ignored the corpus would reach for, and the newest frozen run must step
    // straight over it (R4).
    const live = await seed(EVAL_CORPUS.live, 2, 5);
    const newer = await seed(EVAL_CORPUS.frozen, 3, 21);

    try {
      await signIn(page, "admin");
      await page.goto("/evals");

      // Matched on the title exactly, not on `hasText`: run ids are serial and
      // this database is never wiped, so "Run 7" is a substring of "Run 74"
      // and a substring match would eventually resolve to two cards.
      const card = (id: number) =>
        page.locator('[data-slot="card"]', {
          has: page.getByText(`Run ${id}`, { exact: true }),
        });

      await expect(
        card(newer.id).getByText(`Compared with run ${older.id}`),
      ).toBeVisible();
      // Percentage points, not percent: 92 to 84 is eight points and nine
      // percent, and this page has to mean the first.
      await expect(card(newer.id).getByText("-8pp")).toBeVisible();

      // The live run in between is not even on this page: one corpus at a time,
      // and the control that says which is the same one that aims the Run
      // button (#234).
      await expect(card(live.id)).toHaveCount(0);

      await page.getByRole("combobox", { name: "Corpus", exact: true }).click();
      await page.getByRole("option", { name: "Live articles" }).click();
      await expect(
        page.getByRole("button", { name: "Run live articles" }),
      ).toBeVisible();
      // And the frozen runs step aside for it, rather than the two series
      // interleaving in one column.
      await expect(card(newer.id)).toHaveCount(0);

      // And the live run is compared against neither of the frozen ones. Which
      // run it *is* compared against is deliberately not asserted — that is
      // whatever live run an earlier pass of this suite left behind, and the
      // claim here is only that a frozen run is never the answer.
      //
      // The two counts below are worth nothing on their own: a locator that
      // resolved to no card at all would satisfy both. So the card is asserted
      // on screen first, and asserted to be drawing the comparison line — one
      // predecessor or the sentence that says there is none — before anything
      // is claimed about what that line does *not* say.
      await expect(card(live.id)).toBeVisible();
      await expect(
        card(live.id).getByText(
          /Compared with run \d+|First run on the live articles/,
        ),
      ).toBeVisible();
      await expect(
        card(live.id).getByText(`Compared with run ${older.id}`),
      ).toHaveCount(0);
      await expect(
        card(live.id).getByText(`Compared with run ${newer.id}`),
      ).toHaveCount(0);
    } finally {
      await testDb.evalRun.deleteMany({
        where: { id: { in: [older.id, live.id, newer.id] } },
      });
    }
  });

  test("an agent has no way in, by link or by address", async ({ page }) => {
    // The guard half matters as much as the happy path: this route spends
    // money. `AdminRoute` is UX and `requireAdmin` is the control — both are
    // asserted, here and below.
    await signIn(page, "agent");

    await expect(page.getByRole("link", { name: "Evals" })).toHaveCount(0);

    await page.goto("/evals");
    await page.waitForURL("/");
  });
});

test.describe("the evals API refuses everyone but an admin", () => {
  test("unauthenticated -> 401", async ({ request }) => {
    // Better Auth's session check runs before the role check, so this is 401
    // rather than 403.
    expect((await request.get(`${API_URL}/api/evals/runs`)).status()).toBe(401);
    expect(
      (await request.post(`${API_URL}/api/evals/runs`, { data: {} })).status(),
    ).toBe(401);
  });

  test("an agent session -> 403", async ({ page }) => {
    await signIn(page, "agent");

    expect((await page.request.get(`${API_URL}/api/evals/runs`)).status()).toBe(
      403,
    );
    expect(
      (
        await page.request.post(`${API_URL}/api/evals/runs`, { data: {} })
      ).status(),
    ).toBe(403);
  });

  test("an admin on a keyless deployment -> 503, and no run is recorded", async ({
    page,
  }) => {
    // The refusal is before the row, so a deployment with no key never
    // accumulates runs that read as in flight and can never be answered.
    await signIn(page, "admin");
    const before = await testDb.evalRun.count();

    const res = await page.request.post(`${API_URL}/api/evals/runs`, {
      data: {},
    });

    expect(res.status()).toBe(503);
    expect(await testDb.evalRun.count()).toBe(before);
  });
});

/* ── A real run, against the fake provider, on the AI-enabled server ─────── */

test.describe("a run against the frozen corpus", () => {
  let ctx: APIRequestContext;

  test.beforeAll(async () => {
    // `pwRequest.newContext()` rather than the per-test `request` fixture: the
    // admin's session on :3003 has to survive the sign-in and the runs below.
    ctx = await pwRequest.newContext();
    const res = await ctx.post(`${AI_API_URL}/api/auth/sign-in/email`, {
      data: { email: ADMIN.email, password: ADMIN.password },
    });
    if (!res.ok()) {
      throw new Error(
        `Sign-in failed on the AI server: ${res.status()} ${await res.text()}`,
      );
    }
  });

  test.afterAll(async () => {
    await ctx.dispose();
  });

  /** Start a run on the AI-enabled server and hand back its id. */
  async function start(data: Record<string, unknown>): Promise<number> {
    const res = await ctx.post(`${AI_API_URL}/api/evals/runs`, { data });
    expect(res.status()).toBe(202);
    return ((await res.json()) as { runId: number }).runId;
  }

  test("answers each case five times and records a rate, not a pass", async () => {
    const started = await ctx.post(`${AI_API_URL}/api/evals/runs`, {
      data: { corpus: EVAL_CORPUS.frozen, caseIds: [...SMOKE_CASE_IDS] },
    });

    // 202: accepted, not finished. The whole point of the queue is that the
    // request does not block on a set of model calls.
    expect(started.status()).toBe(202);
    const { runId } = (await started.json()) as { runId: number };

    const run = await waitForRun(runId);

    expect(run.status).toBe(EVAL_RUN_STATUS.completed);
    expect(run.corpus).toBe(EVAL_CORPUS.frozen);
    expect(run.error).toBeNull();
    expect(run.repeats).toBe(5);
    expect(run.results).toHaveLength(SMOKE_CASE_IDS.length);

    for (const result of run.results) {
      // The assertion this slice exists for: `n/5`, never a boolean. The stub
      // answers the same way every time, so five out of five is what a correct
      // harness produces — what would fail here is a runner that asked once.
      expect(result.repeats).toBe(5);
      expect(result.matches).toBe(5);
      expect(Array.isArray(result.verdicts)).toBe(true);
      expect(result.verdicts).toHaveLength(5);
    }

    // And the run's own aggregate, which is the percentage the screen draws.
    // (What the screen makes of it is `EvalsPage.test.tsx`'s job: the browser
    // half of this suite runs against :3002, which has no key and no route to
    // this server.)
    expect(run.attempts).toBe(SMOKE_CASE_IDS.length * 5);
    expect(run.matches).toBe(run.attempts);
    expect(run.abandoned).toBe(0);
  });

  test("a case decided by the gates pays for its classification and nothing else", async () => {
    // `refund` never reaches the *auto-reply* — `gateDecline` answers it from
    // three values, which is what makes four of the ten decline reasons
    // measurable at all and what stops a run paying to re-derive a constant.
    //
    // Since slice 4 it is no longer free, deliberately: the gate reads what the
    // classifier said, so this is the sharpest place to measure the classifier
    // rather than one to skip. What that costs is exactly **one call a repeat
    // instead of two**, and the stub reports the same usage on every call — so
    // a gated case's bill is precisely half an ungated one's, and that is a
    // fact about which calls were made rather than about any number's size.
    const gated = await waitForRun(await start({ caseIds: ["refund"] }));
    const full = await waitForRun(await start({ caseIds: ["off-corpus"] }));

    expect(gated.results[0]!.matches).toBe(5);
    expect(gated.results[0]!.expectedDecline).toBe("category");
    expect(gated.usd).toBeGreaterThan(0);
    expect(full.usd).toBeCloseTo(gated.usd * 2, 10);
  });

  test("scores the classifier beside the auto-reply, and apart from it", async () => {
    // R15, and the reason it is a metric of its own. The stub files everything
    // as General, so `refund` is misfiled every repeat — and its decline
    // accuracy is still a clean 5 of 5, because the gates read the case's
    // *declared* category rather than what the classifier just said. Two
    // findings, two numbers; one blended score would have shown neither.
    const run = await waitForRun(await start({ caseIds: [...SMOKE_CASE_IDS] }));

    const refund = run.results.find((r) => r.caseId === "refund")!;
    const offCorpus = run.results.find((r) => r.caseId === "off-corpus")!;

    expect(refund.expectedCategory).toBe(TICKET_CATEGORY.Refund);
    expect(refund.classifiedRepeats).toBe(5);
    expect(refund.classifyMatches).toBe(0);
    expect(refund.matches).toBe(5);

    expect(offCorpus.expectedCategory).toBe(TICKET_CATEGORY.General);
    expect(offCorpus.classifyMatches).toBe(5);

    // And the run's own roll-up, which is the percentage the screen draws.
    expect(run.classifiedRepeats).toBe(10);
    expect(run.classifyMatches).toBe(5);
  });

  test("does not ask the classifier about a case it cannot score", async () => {
    // `no-inbound-message` carries a placeholder body precisely because nothing
    // reads it, and on the real path there is no ticket to classify at all. No
    // expectation on the row, no call, no cost.
    const run = await waitForRun(
      await start({ caseIds: ["no-inbound-message"] }),
    );

    expect(run.results[0]!.expectedCategory).toBeNull();
    expect(run.classifiedRepeats).toBe(0);
    expect(run.usd).toBe(0);
  });

  test("records what the run cost", async () => {
    // R10. The fake provider reports usage like a real one, so the figure is
    // computed rather than stubbed — what is asserted is that it is recorded at
    // all, which is the thing `logUsage` used to print and throw away.
    const started = await ctx.post(`${AI_API_URL}/api/evals/runs`, {
      data: { caseIds: ["off-corpus"] },
    });
    const { runId } = (await started.json()) as { runId: number };

    const run = await waitForRun(runId);

    expect(run.usd).toBeGreaterThan(0);
  });

  test("a live-corpus run is labelled as one, and kept apart", async () => {
    // R4. The two are never averaged, and what makes that possible is that
    // every run says on its own row which knowledge base answered it. A live
    // run's *outcomes* are deliberately not asserted here — they depend on what
    // the article table happens to hold, which is the whole reason a live run is
    // ambiguous and the nightly runs frozen.
    const started = await ctx.post(`${AI_API_URL}/api/evals/runs`, {
      data: { corpus: EVAL_CORPUS.live, caseIds: ["refund"] },
    });
    const { runId } = (await started.json()) as { runId: number };

    const run = await waitForRun(runId);

    expect(run.corpus).toBe(EVAL_CORPUS.live);
    // Its own row, with its own results. Nothing merges it into the frozen ones.
    expect(run.results).toHaveLength(1);
  });

  test("creates nothing a customer or an agent would see", async () => {
    // R12, asserted the way the PRD asks for it: row counts across a run. It is
    // structural rather than careful — the runner hands a synthesized input to
    // `autoReply` and three values to `gateDecline`, neither of which reaches
    // the code that writes a ticket — and this is what would notice if that ever
    // stopped being true.
    const before = {
      tickets: await testDb.ticket.count(),
      messages: await testDb.message.count(),
      activity: await testDb.ticketActivity.count(),
      outbox: await testDb.outboundEmail.count(),
    };

    const started = await ctx.post(`${AI_API_URL}/api/evals/runs`, {
      data: { caseIds: [...SMOKE_CASE_IDS] },
    });
    const { runId } = (await started.json()) as { runId: number };
    await waitForRun(runId);

    expect(await testDb.ticket.count()).toBe(before.tickets);
    expect(await testDb.message.count()).toBe(before.messages);
    expect(await testDb.ticketActivity.count()).toBe(before.activity);
    expect(await testDb.outboundEmail.count()).toBe(before.outbox);
  });

  test("refuses a case id nothing names", async () => {
    const res = await ctx.post(`${AI_API_URL}/api/evals/runs`, {
      data: { caseIds: ["no-such-case"] },
    });

    expect(res.status()).toBe(400);
  });
});

/**
 * Poll the run row itself rather than any API response — the run happens on
 * pg-boss, asynchronously to the POST that enqueued it. Same shape as
 * `waitForAutoResolved` in `knowledge-auto-reply-approval.spec.ts`, against a
 * different column.
 *
 * The timeout is generous because a run is now repeats × cases: the smoke
 * subset is ten answers against a local stub, which is quick, but a run that is
 * merely slow must not be reported as a run that never finished.
 */
async function waitForRun(runId: number, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const run = await testDb.evalRun.findUniqueOrThrow({
      where: { id: runId },
      include: { results: true },
    });

    if (run.finishedAt !== null) return run;

    if (Date.now() > deadline) {
      throw new Error(
        `Eval run ${runId} did not finish within ${timeoutMs}ms (status ${run.status})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/* ── When runs happen: the schedule, and planned runs (#236) ─────────────── */

/**
 * **The stored arrangement, never a cron actually firing.** What is asserted
 * here is that an admin's edit reaches the row and comes back on the screen,
 * and that a planned run is listed as coming and can be released again. A test
 * that waited for a nightly to fire would be a test that waits a day, and a
 * test that wound the clock forward would be asserting pg-boss's cron parser
 * rather than anything this repo wrote.
 */
test.describe("the eval schedule", () => {
  test("an admin retimes it, and the new time is what comes back", async ({
    page,
  }) => {
    await signIn(page, "admin");
    await page.goto("/evals");

    try {
      const time = page.getByLabel("Time (server clock)");
      await expect(time).toHaveValue("03:47");

      await time.fill("05:15");
      await page.getByRole("button", { name: "Save time" }).click();

      // The row, which is the half a screenshot cannot prove: the time an admin
      // owns is stored rather than compiled in, and the deploy that made it
      // editable did not change the arrangement in force.
      await expect
        .poll(
          async () =>
            (await testDb.evalSchedule.findUnique({ where: { id: 1 } }))?.hour,
        )
        .toBe(5);

      // And it survives a reload, with who changed it beside it — the panel
      // says who last changed the schedule and when.
      await page.reload();
      await expect(page.getByLabel("Time (server clock)")).toHaveValue("05:15");
      await expect(page.getByText(/Last changed by/)).toBeVisible();
    } finally {
      // In a `finally`, because this row is shared state: a failure above
      // would otherwise leave every later run of this suite reading 05:15 and
      // failing its first assertion for a reason that has nothing to do with
      // whatever broke.
      await testDb.evalSchedule.update({
        where: { id: 1 },
        data: { hour: 3, minute: 47, updatedById: null, updatedByName: null },
      });
    }
  });

  test("a planned run is drawn as upcoming, and cancelled from the list", async ({
    page,
  }) => {
    // Seeded rather than planned through the screen, for the reason the failing
    // run above is seeded: this server has no key, so it refuses to *plan* a
    // run — and what is being asserted is how the list draws one, which is a
    // different claim from whether the route accepts it (that is asserted
    // against the AI-enabled server below).
    const plan = await testDb.evalPlannedRun.create({
      data: {
        corpus: EVAL_CORPUS.live,
        runAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
        plannedByName: "Ada Admin",
      },
    });

    try {
      await signIn(page, "admin");
      await page.goto("/evals");

      const row = page.getByRole("listitem").filter({ hasText: "Ada Admin" });
      // Visibly not a run: "Upcoming" is a claim about the future, where every
      // badge on a run card is a claim about a measurement (`docs/adr/0021`).
      await expect(row.getByText("Upcoming")).toBeVisible();
      await expect(row.getByText("Live articles")).toBeVisible();

      await row.getByRole("button", { name: "Cancel" }).click();

      // Gone from what is coming, and cancelled on the row — it never becomes
      // a run.
      await expect(row).toHaveCount(0);
      await expect
        .poll(
          async () =>
            (
              await testDb.evalPlannedRun.findUniqueOrThrow({
                where: { id: plan.id },
              })
            ).status,
        )
        .toBe("cancelled");
    } finally {
      await testDb.evalPlannedRun.deleteMany({ where: { id: plan.id } });
    }
  });
});

test.describe("planned runs", () => {
  let ctx: APIRequestContext;

  test.beforeAll(async () => {
    ctx = await pwRequest.newContext();
    const res = await ctx.post(`${AI_API_URL}/api/auth/sign-in/email`, {
      data: { email: ADMIN.email, password: ADMIN.password },
    });
    if (!res.ok()) {
      throw new Error(
        `Sign-in failed on the AI server: ${res.status()} ${await res.text()}`,
      );
    }
  });

  test.afterAll(async () => {
    await ctx.dispose();
  });

  test("a planned run is listed as coming, is not a run, and can be cancelled", async () => {
    const runsBefore = await testDb.evalRun.count();

    const planned = await ctx.post(`${AI_API_URL}/api/evals/planned-runs`, {
      data: {
        corpus: EVAL_CORPUS.live,
        // Two hours out: far enough that nothing fires inside this test, close
        // enough to be well inside the horizon the route enforces.
        runAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      },
    });
    expect(planned.status()).toBe(201);
    const { id } = (await planned.json()) as { id: number };

    const panel = await ctx.get(`${AI_API_URL}/api/evals/schedule`);
    expect(panel.status()).toBe(200);
    const listed = (
      (await panel.json()) as { plannedRuns: { id: number; status: string }[] }
    ).plannedRuns;
    expect(listed.map((row) => row.id)).toContain(id);

    // **Not a run**, and this is the assertion `docs/adr/0021` is for: a plan
    // has measured nothing, so nothing is written to the table that says what
    // was measured.
    expect(await testDb.evalRun.count()).toBe(runsBefore);

    const cancelled = await ctx.delete(
      `${AI_API_URL}/api/evals/planned-runs/${id}`,
    );
    expect(cancelled.status()).toBe(200);

    const after = await ctx.get(`${AI_API_URL}/api/evals/schedule`);
    const remaining = (
      (await after.json()) as { plannedRuns: { id: number }[] }
    ).plannedRuns;
    // It never becomes a run, and it is gone from what is coming.
    expect(remaining.map((row) => row.id)).not.toContain(id);
  });

  test("refuses a plan for a moment that has passed", async () => {
    const res = await ctx.post(`${AI_API_URL}/api/evals/planned-runs`, {
      data: {
        corpus: EVAL_CORPUS.frozen,
        runAt: new Date(Date.now() - 60_000).toISOString(),
      },
    });

    expect(res.status()).toBe(400);
  });
});
