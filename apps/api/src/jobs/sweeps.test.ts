import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import {
  ADMIN_ACTIVITY_ACTION,
  KNOWLEDGE_REVISION_ACTION,
  OUTBOUND_EMAIL_KIND,
  OUTBOUND_EMAIL_STATUS,
  TICKET_ACTIVITY_ACTION,
  TICKET_ACTOR_KIND,
  TICKET_CATEGORY,
  TICKET_STATUS,
  type OutboundEmailKind,
  type OutboundEmailStatus,
  type TicketStatus,
} from "@ticket/shared";
import { Prisma, prisma, resetDb } from "../test/pg";

/**
 * All four scheduled sweeps, called directly — no pg-boss anywhere.
 *
 * That is the property under test as much as the outcomes are (#158). Each one
 * is now a `SweepSpec`, which is a value, so `run` is a plain function over the
 * rows in the database. Before this they were closures passed straight into
 * `boss.work` at registration time, reachable only by standing up a queue and
 * waiting for a cron tick — which is why none of them had a test, and why the
 * two most consequential had never been observed doing the thing they exist for.
 *
 * The database is real (`../test/pg`, ADR-0014), and here that is the whole
 * point rather than a convenience: every one of these sweeps *is* a query. What
 * a fake client would be asserting is a re-implementation of the age band,
 * the `notIn`, and the status filter — the three things most worth getting
 * right, and the three a fake would be free to get wrong in the same way twice.
 *
 * ## The two mocks, and why both default to the truth
 *
 * `../ai/provider` and `./boss` are both replaced with the real module spread
 * into a plain object first, so every other export stays genuine — see the
 * registry note in `docs/standards/testing.md`.
 *
 * **Each replaced export behaves exactly like the real one until a test opts
 * out, and that is the load-bearing part.** `mock.module`'s registry is one
 * process wide and nothing resets it between files, so these two fakes are in
 * force for every file that links `../ai/provider` or `./boss` after this one —
 * and which files those are depends on the order `bun test` reaches them in,
 * which differs between a Windows dev machine and CI. A fake whose default is
 * indistinguishable from the real module cannot make that ordering matter.
 *
 * So `isAiConfigured` starts `false`, which is what the real one returns in
 * this suite (no `OPENAI_API_KEY` anywhere in `.env.test`, deliberately); only
 * the reconcile tests flip it, and `beforeEach` puts it back. It has to be
 * reachable at all because `enqueueClassification` short-circuits on it —
 * without the flip, the sweep's whole output is a no-op and there is nothing to
 * assert.
 *
 * And `getBoss` delegates to the real one — which throws, the queue never
 * having been started — unless a test has installed a queue to watch. That
 * matters to a specific neighbour: `classify-ticket.test.ts` imports the same
 * `./classify-ticket` and says in its own header that "`getBoss()` would throw,
 * and nothing below reaches it". A fake that unconditionally returned a working
 * queue would quietly make that sentence false in one of the two load orders,
 * which is the shape `testing.md` warns about — a file that passes alone and
 * fails in the suite.
 */

mock.module("../db", () => ({ Prisma, prisma }));

// Spread into a plain object *now*, before the mock is registered: `mock.module`
// replaces the live namespace, so a factory that spreads the import binding is
// spreading itself.
const provider = { ...(await import("../ai/provider")) };
let aiConfigured = false;
mock.module("../ai/provider", () => ({
  ...provider,
  isAiConfigured: () => aiConfigured,
}));

/** Everything a sweep asked to be enqueued, in order. */
let enqueued: { queue: string; ticketId: number }[] = [];

/**
 * The queue a test is watching, or `undefined` for "behave like the real
 * module". Set by `watchQueue()` and cleared in `beforeEach`.
 */
let watchedQueue: { send: (queue: string, data: unknown) => Promise<string> } | undefined;

const bossModule = { ...(await import("./boss")) };
mock.module("./boss", () => ({
  ...bossModule,
  // The only export replaced. `registerWorker`, `registerSweep` and the rest
  // stay real, which is what keeps `boss.test.ts` honest whichever order the
  // two files load in — and `getBoss` falls through to the real one, which
  // throws, unless this file's own test asked to watch a queue. See the header.
  getBoss: () => watchedQueue ?? bossModule.getBoss(),
}));

/** Record what the sweep enqueues, instead of letting `getBoss()` throw. */
function watchQueue(): void {
  watchedQueue = {
    send: async (queue: string, data: unknown) => {
      enqueued.push({ queue, ticketId: (data as { ticketId: number }).ticketId });
      return "fake-job-id";
    },
  };
}

const { CLASSIFY_QUEUE, CLASSIFY_RECONCILE_SWEEP } = await import(
  "./classify-ticket"
);
const { AUTO_REPLY_RECOVER_SWEEP } = await import("./auto-reply-ticket");
const { PRUNE_OUTBOX_SWEEP } = await import("./prune-outbox");
const { PRUNE_ACTIVITY_TRAILS_SWEEP } = await import("./prune-activity-trails");

/* ── Fixtures ────────────────────────────────────────────────────────────── */

const MINUTE = 60 * 1_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function ago(ms: number): Date {
  return new Date(Date.now() - ms);
}

async function newTicket(
  overrides: {
    status?: TicketStatus;
    createdAt?: Date;
    classifiedAt?: Date;
    category?: (typeof TICKET_CATEGORY)[keyof typeof TICKET_CATEGORY];
  } = {},
): Promise<number> {
  const ticket = await prisma.ticket.create({
    data: {
      subject: "My login is broken",
      customerEmail: "customer@example.com",
      customerName: "Casey Customer",
      ...overrides,
    },
    select: { id: true },
  });
  return ticket.id;
}

/**
 * Backdate a ticket's timestamps in one statement.
 *
 * Raw SQL because `updatedAt` is `@updatedAt`: Prisma owns that column and
 * writes `now()` into it on every create and update, so there is no way through
 * the client to produce the row a crashed worker leaves behind. And `updatedAt`
 * is exactly what the recovery sweep reads — the claim is what moves it.
 */
async function backdate(id: number, createdAt: Date, updatedAt: Date) {
  await prisma.$executeRaw`
    UPDATE "ticket" SET "createdAt" = ${createdAt}, "updatedAt" = ${updatedAt}
    WHERE "id" = ${id}
  `;
}

async function statusOf(id: number): Promise<string | undefined> {
  const row = await prisma.ticket.findUnique({
    where: { id },
    select: { status: true },
  });
  return row?.status;
}

async function outboundRow(overrides: {
  kind: OutboundEmailKind;
  status: OutboundEmailStatus;
  createdAt: Date;
}): Promise<number> {
  const row = await prisma.outboundEmail.create({
    data: {
      toEmail: "someone@example.com",
      subject: "Re: My login is broken",
      textBody: "Have you tried turning it off and on again?",
      ...overrides,
    },
    select: { id: true },
  });
  return row.id;
}

async function outboxIds(): Promise<number[]> {
  const rows = await prisma.outboundEmail.findMany({
    select: { id: true },
    orderBy: { id: "asc" },
  });
  return rows.map((row) => row.id);
}

/** Quiet: every sweep here logs when it finds something, which is every test. */
let quiet: ReturnType<typeof spyOn>[] = [];

beforeEach(async () => {
  await resetDb();
  enqueued = [];
  aiConfigured = false;
  watchedQueue = undefined;
  quiet = [
    spyOn(console, "log").mockImplementation(() => {}),
    spyOn(console, "warn").mockImplementation(() => {}),
  ];
});

afterEach(() => {
  for (const spy of quiet) spy.mockRestore();
  // Cleared here as well as in `beforeEach`, so the fake is guaranteed to be
  // back to real behaviour once this file's last test finishes rather than only
  // because of which test happens to be last. Nothing else in the process
  // should ever see a working queue from `getBoss()`.
  watchedQueue = undefined;
});

/* ── The classifier's reconcile ──────────────────────────────────────────── */

describe("CLASSIFY_RECONCILE_SWEEP", () => {
  test("offers back a ticket that never reached a verdict", async () => {
    aiConfigured = true;
    watchQueue();
    const id = await newTicket({ createdAt: ago(30 * MINUTE) });

    await CLASSIFY_RECONCILE_SWEEP.run();

    expect(enqueued).toEqual([{ queue: CLASSIFY_QUEUE, ticketId: id }]);
  });

  test("leaves alone everything outside the band", async () => {
    aiConfigured = true;
    watchQueue();

    // Inside the ten-minute floor: already queued, or already retrying — the
    // ladder runs a little over seven minutes, so anything this fresh is in
    // hand and a second job would only be a second model call.
    await newTicket({ createdAt: ago(2 * MINUTE) });
    // Past the twenty-four-hour ceiling: a ticket nobody classified in a day is
    // one to look at by hand, not one to keep paying for forever.
    await newTicket({ createdAt: ago(2 * DAY) });
    // A verdict was reached — filed, or given up on by the dead-letter path.
    await newTicket({ createdAt: ago(30 * MINUTE), classifiedAt: ago(20 * MINUTE) });
    // An agent categorised it by hand during the call. `classifiedAt` is still
    // null, which is the distinction that column exists to draw: this is not
    // "never attempted", and re-offering it would fight the person.
    await newTicket({
      createdAt: ago(30 * MINUTE),
      category: TICKET_CATEGORY.Technical,
    });

    await CLASSIFY_RECONCILE_SWEEP.run();

    expect(enqueued).toEqual([]);
  });

  test("enqueues nothing on a deployment with no key", async () => {
    // `aiConfigured` stays false and no queue is watched, so `getBoss()` is the
    // real one and would throw. The sweep still runs and still reads the
    // tickets; `enqueueClassification` is the no-op, and that is deliberate —
    // a keyless deployment must not build a backlog for the day somebody adds
    // a key. This is the state the E2E suite runs in, and the throw is what
    // makes the assertion below mean "never asked" rather than "asked nothing".
    await newTicket({ createdAt: ago(30 * MINUTE) });

    await CLASSIFY_RECONCILE_SWEEP.run();

    expect(enqueued).toEqual([]);
  });
});

/* ── The auto-reply's recovery ───────────────────────────────────────────── */

describe("AUTO_REPLY_RECOVER_SWEEP", () => {
  test("releases a ticket a dead worker left claimed", async () => {
    const id = await newTicket({ status: TICKET_STATUS.Processing });
    await backdate(id, ago(HOUR), ago(10 * MINUTE));

    await AUTO_REPLY_RECOVER_SWEEP.run();

    // Back to `New`, not `Open`: the expired job is still coming, and this is
    // what gives it something to claim. `Open` would also assign an owner, and
    // the claim can only take an unassigned ticket — the release would put the
    // ticket beyond the reach of its own retry.
    expect(await statusOf(id)).toBe(TICKET_STATUS.New);
  });

  test("leaves a claim that is still fresh alone", async () => {
    // Held for under the staleness window: a worker is on it right now, and
    // releasing it would let a second one claim the same ticket — the exact
    // double-reply this status exists to prevent.
    const id = await newTicket({ status: TICKET_STATUS.Processing });
    await backdate(id, ago(HOUR), ago(MINUTE));

    await AUTO_REPLY_RECOVER_SWEEP.run();

    expect(await statusOf(id)).toBe(TICKET_STATUS.Processing);
  });

  test("leaves a ticket nobody claimed alone", async () => {
    const id = await newTicket({ status: TICKET_STATUS.Open });
    await backdate(id, ago(HOUR), ago(10 * MINUTE));

    await AUTO_REPLY_RECOVER_SWEEP.run();

    expect(await statusOf(id)).toBe(TICKET_STATUS.Open);
  });

  test("stops looking past a day old", async () => {
    // The sweep's own ceiling. A ticket stuck for longer than this is not a
    // crashed worker any more, and releasing it back to `New` would put it in
    // front of the auto-reply a day late.
    const id = await newTicket({ status: TICKET_STATUS.Processing });
    await backdate(id, ago(2 * DAY), ago(2 * DAY));

    await AUTO_REPLY_RECOVER_SWEEP.run();

    expect(await statusOf(id)).toBe(TICKET_STATUS.Processing);
  });
});

/* ── The outbox sweep ────────────────────────────────────────────────────── */

describe("PRUNE_OUTBOX_SWEEP", () => {
  test("keeps a reply's delivery record for a season and an invitation for a day", async () => {
    const oldReply = await outboundRow({
      kind: OUTBOUND_EMAIL_KIND.reply,
      status: OUTBOUND_EMAIL_STATUS.sent,
      createdAt: ago(100 * DAY),
    });
    const recentReply = await outboundRow({
      kind: OUTBOUND_EMAIL_KIND.reply,
      status: OUTBOUND_EMAIL_STATUS.sent,
      createdAt: ago(30 * DAY),
    });
    const staleInvitation = await outboundRow({
      kind: OUTBOUND_EMAIL_KIND.invitation,
      status: OUTBOUND_EMAIL_STATUS.undeliverable,
      createdAt: ago(30 * DAY),
    });
    const freshInvitation = await outboundRow({
      kind: OUTBOUND_EMAIL_KIND.invitation,
      status: OUTBOUND_EMAIL_STATUS.undeliverable,
      createdAt: new Date(),
    });

    await PRUNE_OUTBOX_SWEEP.run();

    // Thirty days is the discriminating age: past a reply's ninety-day window
    // it is not, and past an invitation's — which is `RESET_TOKEN_TTL_SECONDS`,
    // a day — it very much is. The assertion holds for any auth-mail retention
    // under a month, so tuning the token's life does not break it; what it
    // pins is that the two kinds are *not* kept for the same time, which is the
    // whole reason `RETENTION_MS` is a `Record` rather than a constant.
    expect(await outboxIds()).toEqual([recentReply, freshInvitation]);
    expect(await outboxIds()).not.toContain(oldReply);
    expect(await outboxIds()).not.toContain(staleInvitation);
  });

  test("never deletes a queued row, however old", async () => {
    // The safety property, and the reason `PRUNABLE_STATUS` is a list rather
    // than "not queued": a queued row has a job on its way to fetch it, and
    // deleting one silently drops an email the app has already promised.
    const queued = await outboundRow({
      kind: OUTBOUND_EMAIL_KIND.reply,
      status: OUTBOUND_EMAIL_STATUS.queued,
      createdAt: ago(1_000 * DAY),
    });

    await PRUNE_OUTBOX_SWEEP.run();

    expect(await outboxIds()).toEqual([queued]);
  });
});

/* ── The audit-trail sweep ───────────────────────────────────────────────── */

describe("PRUNE_ACTIVITY_TRAILS_SWEEP", () => {
  test("deletes trail rows past a year and keeps the rest", async () => {
    const ticketId = await newTicket();

    const old = await prisma.ticketActivity.create({
      data: {
        ticketId,
        action: TICKET_ACTIVITY_ACTION.created,
        actorKind: TICKET_ACTOR_KIND.customer,
        actorName: "Casey Customer",
        createdAt: ago(400 * DAY),
      },
      select: { id: true },
    });
    const recent = await prisma.ticketActivity.create({
      data: {
        ticketId,
        action: TICKET_ACTIVITY_ACTION.status_changed,
        actorKind: TICKET_ACTOR_KIND.agent,
        actorName: "Alex Agent",
        createdAt: ago(30 * DAY),
      },
      select: { id: true },
    });
    await prisma.adminActivity.create({
      data: {
        action: ADMIN_ACTIVITY_ACTION.user_created,
        actorName: "Ada Admin",
        actorEmail: "ada@example.com",
        targetUserName: "Alex Agent",
        createdAt: ago(400 * DAY),
      },
    });

    await PRUNE_ACTIVITY_TRAILS_SWEEP.run();

    const left = await prisma.ticketActivity.findMany({ select: { id: true } });
    expect(left.map((row) => row.id)).toEqual([recent.id]);
    expect(left.map((row) => row.id)).not.toContain(old.id);
    expect(await prisma.adminActivity.count()).toBe(0);
  });

  test("keeps an article's last revision however old it is", async () => {
    await prisma.knowledgeArticle.create({
      data: {
        id: "KB-001",
        title: "How do I reset my password?",
        category: TICKET_CATEGORY.Technical,
        body: "Use the link on the sign-in page.",
      },
    });

    const first = await knowledgeRevision("KB-001", ago(500 * DAY));
    const latest = await knowledgeRevision("KB-001", ago(400 * DAY));

    await PRUNE_ACTIVITY_TRAILS_SWEEP.run();

    // Both are years past the window and only one goes. `docs/adr/0006` makes
    // an article undeletable by construction — `Restrict` on the revision's
    // `article` relation, and every article gets a `created` revision in the
    // same transaction. Sweeping the last one away would quietly reopen that
    // hole on the first article nobody has edited in a year.
    const left = await prisma.knowledgeArticleRevision.findMany({
      select: { id: true },
    });
    expect(left.map((row) => row.id)).toEqual([latest]);
    expect(left.map((row) => row.id)).not.toContain(first);
  });
});

async function knowledgeRevision(
  articleId: string,
  createdAt: Date,
): Promise<number> {
  const revision = await prisma.knowledgeArticleRevision.create({
    data: {
      articleId,
      action: KNOWLEDGE_REVISION_ACTION.updated,
      title: "How do I reset my password?",
      category: TICKET_CATEGORY.Technical,
      body: "Use the link on the sign-in page.",
      autoReply: true,
      archived: false,
      editorName: "Ada Admin",
      createdAt,
    },
    select: { id: true },
  });
  return revision.id;
}
