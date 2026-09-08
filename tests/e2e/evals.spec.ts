import {
  expect,
  request as pwRequest,
  test,
  type APIRequestContext,
} from "@playwright/test";
import { EVAL_CORPUS, EVAL_RUN_STATUS, PIPELINE_OUTCOME } from "@ticket/shared";
import { SLICE_ONE_CASE_ID } from "@ticket/core";
import { CREDENTIALS, signIn } from "./helpers/auth";
import { testDb } from "./helpers/db";
import { API_URL } from "./helpers/env";

/**
 * Slice 1 of the eval harness — an admin starts a run, a case is answered, and
 * a row says what was expected, what was reached, and whether they matched.
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
 * browser half can and does prove is the screen and both guards.
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
    // admin's session on :3003 has to survive the sign-in and the run below.
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

  test("answers the case and records what it reached", async () => {
    const started = await ctx.post(`${AI_API_URL}/api/evals/runs`, {
      data: {},
    });

    // 202: accepted, not finished. The whole point of the queue is that the
    // request does not block on a model call.
    expect(started.status()).toBe(202);
    const { runId } = (await started.json()) as { runId: number };

    const run = await waitForRun(runId);

    expect(run.status).toBe(EVAL_RUN_STATUS.completed);
    expect(run.corpus).toBe(EVAL_CORPUS.frozen);
    expect(run.error).toBeNull();
    expect(run.results).toHaveLength(1);

    const [result] = run.results;
    expect(result!.caseId).toBe(SLICE_ONE_CASE_ID);
    // The expectation comes from the shared case set and the outcome from a
    // real trip through `autoReply` — which is the thing slice 1 exists to
    // retire: a synthesized input reproduces a verdict the pipeline would have
    // reached.
    expect(result!.expectedOutcome).toBe(PIPELINE_OUTCOME.declined);
    expect(result!.expectedDecline).toBe("notCovered");
    expect(result!.actualOutcome).toBe(PIPELINE_OUTCOME.declined);
    expect(result!.actualDecline).toBe("notCovered");
    expect(result!.matched).toBe(true);
  });

  test("creates nothing a customer or an agent would see", async () => {
    // R12, asserted the way the PRD asks for it: row counts across a run. It is
    // structural rather than careful — the runner hands a synthesized input to
    // `autoReply`, which never reaches the code that writes a ticket — and this
    // is what would notice if that ever stopped being true.
    const before = {
      tickets: await testDb.ticket.count(),
      messages: await testDb.message.count(),
      activity: await testDb.ticketActivity.count(),
      outbox: await testDb.outboundEmail.count(),
    };

    const started = await ctx.post(`${AI_API_URL}/api/evals/runs`, {
      data: {},
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
      data: { caseId: "no-such-case" },
    });

    expect(res.status()).toBe(400);
  });
});

/**
 * Poll the run row itself rather than any API response — the run happens on
 * pg-boss, asynchronously to the POST that enqueued it. Same shape as
 * `waitForAutoResolved` in `knowledge-auto-reply-approval.spec.ts`, against a
 * different column.
 */
async function waitForRun(runId: number, timeoutMs = 30_000) {
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
