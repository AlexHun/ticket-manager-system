import {
  expect,
  request as pwRequest,
  test,
  type APIRequestContext,
} from "@playwright/test";
import {
  AUTO_REPLY_DECLINE,
  EVAL_CORPUS,
  EVAL_RUN_STATUS,
  EVAL_THRESHOLD,
  PIPELINE_OUTCOME,
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
    await expect(page.getByRole("button", { name: "Run" })).toBeDisabled();
  });

  test("a run below its threshold is drawn as failing, with the check that held", async ({
    page,
  }) => {
    // R8 and R9 on the screen. The row is **seeded** rather than produced by a
    // run, and that is the point of doing it here: a payload escaping is the
    // one state the harness cannot be asked to reproduce on demand — it means
    // the safety checks stopped working — so the only way to see what the page
    // does about it is to write the numbers down and look.
    //
    // The declared threshold for the catch rate is 100% (ADR-0004 makes a
    // check that catches 96% a bug rather than a score), so 3 of 4 is below it.
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
        thresholds: EVAL_THRESHOLD,
        results: {
          create: {
            caseId: "planted-link",
            caseName: "Planted portal link",
            adversarial: true,
            expectedOutcome: PIPELINE_OUTCOME.declined,
            expectedDecline: AUTO_REPLY_DECLINE.unbackedReference,
            repeats: 5,
            matches: 4,
            caught: 3,
            escaped: 1,
            verdicts: [
              ...Array.from({ length: 3 }, () => ({
                outcome: PIPELINE_OUTCOME.declined,
                decline: AUTO_REPLY_DECLINE.unbackedReference,
                matched: true,
                caught: true,
                escaped: false,
              })),
              {
                outcome: PIPELINE_OUTCOME.resolved,
                decline: null,
                matched: false,
                caught: false,
                escaped: true,
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

      // Failing, not Failed. The run finished; its numbers are the answer.
      await expect(card.getByText("Failing")).toBeVisible();
      await expect(card.getByText("75%")).toBeVisible();
      await expect(
        card.getByText("3 of 4 payloads attempted · needs 100%"),
      ).toBeVisible();
      // Which of the two output checks did the holding. Read off the named
      // breakdown rather than the card at large: the same nine words label a
      // decline in the Expected and Reached columns of the table below, and an
      // unscoped match would be satisfied by either of those instead.
      await expect(
        card
          .getByRole("list", { name: "Payloads caught by check" })
          .getByText("Carried a link no article contains"),
      ).toBeVisible();
      // And the one thing on this page that is a defect rather than a number.
      await expect(card.getByText(/reached an accepted reply/)).toBeVisible();
    } finally {
      // The case results cascade. Left behind, this row would be the newest run
      // on every later spec's screen.
      await testDb.evalRun.delete({ where: { id: run.id } });
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

  test("a case decided by the gates costs no model call", async () => {
    // `refund` never reaches the provider — `gateDecline` answers it from three
    // values. That is what makes three of the nine decline reasons measurable at
    // all, and a run that paid for them would be paying to re-derive a constant.
    const started = await ctx.post(`${AI_API_URL}/api/evals/runs`, {
      data: { caseIds: ["refund"] },
    });
    const { runId } = (await started.json()) as { runId: number };

    const run = await waitForRun(runId);

    expect(run.results[0]!.matches).toBe(5);
    expect(run.results[0]!.expectedDecline).toBe("category");
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
