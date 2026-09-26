/**
 * Unit tests for `apps/api/src/jobs/demo-reset.ts` — the nightly reset (#323,
 * PRD R6).
 *
 * `run` is reached as a plain function call because the spec is a value
 * (`backend.md`, #158). Nothing here waits for a cron, and no queue is started.
 *
 * **Nothing is mocked.** The sweep is a handful of queries over tickets, users
 * and sessions, and the database is real (`../test/pg`, ADR-0014); demo mode is
 * an environment variable read per call (`demo/mode.ts`), so a test flips it
 * rather than replacing a module. No specifier is registered here, so this file
 * cannot poison another's.
 *
 * **One night, many assertions.** Seeding the showcase is a hundred tickets and
 * their threads, ~4s on a Windows dev machine, and a reset is that again. So
 * the main block arranges one night's worth of visitors in `beforeAll`, runs
 * the sweep once, and each test reads one consequence of it.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  EVAL_CORPUS,
  TICKET_STATUS,
  USER_ROLE,
  type TicketStatus,
} from "@ticket/shared";
import { COLLEAGUE, seedColleagues, seedTicket } from "../test/fixtures";
import { prisma, resetDb } from "../test/pg";

const { DEMO_RESET_SWEEP } = await import("./demo-reset");
const { seedShowcase } = await import("../demo/showcase");

/** Seeding and resetting a hundred tickets is slow on PGLite under Windows. */
const NIGHT_TIMEOUT_MS = 60_000;

const HOUR = 60 * 60 * 1000;

const savedDemoMode = process.env.DEMO_MODE_ENABLED;

afterAll(() => {
  if (savedDemoMode === undefined) delete process.env.DEMO_MODE_ENABLED;
  else process.env.DEMO_MODE_ENABLED = savedDemoMode;
});

/**
 * A demo identity the way the `anonymous` plugin mints one, with a session
 * that ends at `expiresAt` — or none at all, which is a visitor who signed out.
 */
async function seedVisitor(id: string, expiresAt: Date | null) {
  await prisma.user.create({
    data: {
      id,
      name: "Demo visitor",
      email: `temp-${id}@demo.example.com`,
      role: USER_ROLE.agent,
      isAnonymous: true,
    },
  });
  if (expiresAt) {
    await prisma.session.create({
      data: { id: `s_${id}`, token: `t_${id}`, userId: id, expiresAt },
    });
  }
}

/**
 * The first seeded ticket in `status`. Only called before anything but the
 * showcase is in the table, so every row it can find is a seeded one.
 */
function firstSeededIn(status: TicketStatus, skip = 0) {
  return prisma.ticket.findFirstOrThrow({
    where: { status },
    orderBy: { id: "asc" },
    skip,
    select: { subject: true, customerEmail: true },
  });
}

/** The ticket now carrying a seeded row's key — a reset re-creates it. */
function bySeedKey(key: { subject: string; customerEmail: string }) {
  return prisma.ticket.findFirstOrThrow({
    where: key,
    select: { status: true, assignedToId: true },
  });
}

describe("DEMO_RESET_SWEEP, one night", () => {
  const LIVE = "u_demo_live";
  const EXPIRED = "u_demo_expired";
  const SIGNED_OUT = "u_demo_signed_out";

  let closed: { subject: string; customerEmail: string };
  let taken: { subject: string; customerEmail: string };
  let ingestedId: number;
  let evalsBefore: Awaited<ReturnType<typeof evalRows>>;

  beforeAll(async () => {
    process.env.DEMO_MODE_ENABLED = "true";
    await resetDb();
    await seedColleagues("admin", "agent", "other");
    const now = Date.now();
    await seedVisitor(LIVE, new Date(now + HOUR));
    await seedVisitor(EXPIRED, new Date(now - HOUR));
    await seedVisitor(SIGNED_OUT, null);

    await seedShowcase();

    // The day's visitors: one closes a ticket, the one still here takes one.
    closed = await firstSeededIn(TICKET_STATUS.Open);
    await prisma.ticket.updateMany({
      where: closed,
      data: { status: TICKET_STATUS.Closed },
    });
    taken = await firstSeededIn(TICKET_STATUS.Open, 1);
    await prisma.ticket.updateMany({
      where: taken,
      data: { assignedToId: LIVE },
    });

    // A real customer's ticket, worked to Resolved.
    ingestedId = (await seedTicket({ status: TICKET_STATUS.Resolved })).id;

    const run = await prisma.evalRun.create({
      data: { corpus: EVAL_CORPUS.frozen, matches: 3 },
    });
    await prisma.evalCaseResult.create({
      data: {
        runId: run.id,
        caseId: "refund-duplicate",
        caseName: "Duplicate charge",
        adversarial: false,
        expectedOutcome: "resolved",
        verdicts: [],
      },
    });
    evalsBefore = await evalRows();

    await DEMO_RESET_SWEEP.run();
  }, NIGHT_TIMEOUT_MS);

  test("a seeded ticket a demo closed is back to its seeded status", async () => {
    expect((await bySeedKey(closed)).status).toBe(TICKET_STATUS.Open);
  });

  test("a ticket that arrived through ingestion keeps its status", async () => {
    const ticket = await prisma.ticket.findUniqueOrThrow({
      where: { id: ingestedId },
      select: { status: true },
    });
    expect(ticket.status).toBe(TICKET_STATUS.Resolved);
  });

  test("no seeded ticket is assigned to a demo identity, even one still here", async () => {
    expect((await bySeedKey(taken)).assignedToId).not.toBe(LIVE);
    expect(
      await prisma.ticket.count({
        where: { assignedTo: { isAnonymous: true } },
      }),
    ).toBe(0);
  });

  test("seeded tickets are shared among the colleagues", async () => {
    const owners = await prisma.ticket.groupBy({
      by: ["assignedToId"],
      where: { assignedToId: { not: null } },
    });
    expect(owners.map((o) => o.assignedToId).sort()).toEqual(
      [COLLEAGUE.admin.id, COLLEAGUE.agent.id, COLLEAGUE.other.id].sort(),
    );
  });

  test("demo identities whose sessions ended are gone, sessions with them", async () => {
    const left = await prisma.user.findMany({
      where: { isAnonymous: true },
      select: { id: true },
    });
    expect(left.map((u) => u.id)).toEqual([LIVE]);
    expect(
      await prisma.session.count({ where: { userId: { in: [EXPIRED] } } }),
    ).toBe(0);
  });

  test("a demo identity with a live session keeps it", async () => {
    expect(await prisma.session.count({ where: { userId: LIVE } })).toBe(1);
  });

  test("the showcase is whole again: a hundred seeded tickets, one real one", async () => {
    expect(await prisma.ticket.count()).toBe(101);
  });

  test("eval runs and their results are unchanged", async () => {
    expect(await evalRows()).toEqual(evalsBefore);
  });
});

describe("DEMO_RESET_SWEEP, with demo mode off", () => {
  test("touches nothing: no showcase is written and no identity is removed", async () => {
    process.env.DEMO_MODE_ENABLED = "false";
    await resetDb();
    await seedColleagues("admin");
    await seedVisitor("u_demo_gone", new Date(Date.now() - HOUR));
    const real = await seedTicket({ status: TICKET_STATUS.Closed });

    await DEMO_RESET_SWEEP.run();

    const tickets = await prisma.ticket.findMany({ select: { id: true } });
    expect(tickets).toEqual([{ id: real.id }]);
    expect(await prisma.user.count({ where: { isAnonymous: true } })).toBe(1);
  });
});

describe("DEMO_RESET_SWEEP, on a night the showcase cannot be written", () => {
  // Nobody a ticket could be handed to, so `seedShowcase` throws. The sweep
  // has no retry, so ended visitors must already be gone by then.
  test("still removes the demo visitors whose sessions ended", async () => {
    process.env.DEMO_MODE_ENABLED = "true";
    await resetDb();
    await seedVisitor("u_demo_gone", new Date(Date.now() - HOUR));

    await expect(DEMO_RESET_SWEEP.run()).rejects.toThrow("No users found");

    expect(await prisma.user.count({ where: { isAnonymous: true } })).toBe(0);
  });
});

test("is scheduled for 00:00 every day, which pg-boss reads as UTC", () => {
  expect(DEMO_RESET_SWEEP.cron).toBe("0 0 * * *");
});

function evalRows() {
  return Promise.all([
    prisma.evalRun.findMany({ orderBy: { id: "asc" } }),
    prisma.evalCaseResult.findMany({ orderBy: { id: "asc" } }),
  ]);
}
