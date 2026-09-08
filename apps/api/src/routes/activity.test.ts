/**
 * Unit tests for `GET /api/activity`, the unified admin activity feed.
 *
 * **The database is real here, and for this route that changes what a test can
 * be about** (`../test/pg`, ADR-0014). The feed is one hand-written `UNION ALL`
 * over five tables, and until #171 nothing in the unit suite could execute it:
 * `$queryRaw` was a stub, so the assertions were about the SQL *text* handed to
 * it — which table names the string mentioned, and whether a filter's value
 * turned up in the bind array rather than spliced into the query. That catches
 * a branch dropped from `BRANCHES`, and nothing else.
 *
 * What it could not see is most of what this route is:
 *
 *   - a mistyped column alias. `FeedRow` is an unchecked cast over `$queryRaw`,
 *     so a renamed alias is `undefined` at runtime and compiles fine — the
 *     route's own comment says so;
 *   - the `CASE` in the automation branch reading the wrong side;
 *   - `ORDER BY "createdAt" DESC, "id" DESC` applying to the merge rather than
 *     to each branch, which is the only reason a single `UNION ALL` is worth
 *     writing by hand at all;
 *   - the `::timestamptz AT TIME ZONE 'UTC'` cast in `ts()`, whose whole job is
 *     to land a day boundary on the right side;
 *   - each branch filtering `actorId` on *its own* column — `actorId`,
 *     `authorId`, `editorId`, `changedById` — where counting five identical
 *     bind values could not tell one column from another.
 *
 * All of those are Postgres' own answer now. The tests below seed rows in the
 * five source tables and read which entries come back, so "which branches are
 * included" is a fact about the feed rather than about the query string.
 *
 * `../middleware/auth` is still stubbed, and the stub is deliberately identical
 * to the ones in `./automation.test.ts`, `./ai.test.ts`, `./knowledge.test.ts`,
 * `./tutorials.test.ts` and `./users.test.ts` — see `docs/standards/testing.md`.
 * None of those factories spreads the real module and the registry is
 * process-wide, so all six have to agree on every header and default.
 */

import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  ACTIVITY_ENTITY_TYPE,
  ADMIN_ACTIVITY_ACTION,
  DEFAULT_PAGE_SIZE,
  FIRST_PAGE,
  HANDOFF_TARGET,
  KNOWLEDGE_REVISION_ACTION,
  MESSAGE_DIRECTION,
  TICKET_ACTIVITY_ACTION,
  TICKET_ACTOR_KIND,
  TICKET_CATEGORY,
  USER_ROLE,
  type ActivityEntry,
  type AdminActivityAction,
  type HandoffTarget,
  type KnowledgeRevisionAction,
  type MessageDirection,
  type TicketActivityAction,
} from "@ticket/shared";
import { COLLEAGUE, seedColleagues, seedTicket } from "../test/fixtures";
import { prisma, resetDb } from "../test/pg";
import { serveRouter } from "../test/route-app";

/* ── The world behind the route ──────────────────────────────────────────── */

/** Deliberately identical to `./automation.test.ts`, `./ai.test.ts` and
 *  `routes/knowledge.test.ts` — see this file's header comment. */
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

const { activityRouter, toActivityEntry } = await import("./activity");

/* ── toActivityEntry: the one pure function ─────────────────────────────── */

describe("toActivityEntry", () => {
  test("carries every column straight across and formats the date", () => {
    const row = {
      id: "ticket_activity:42",
      entityType: "ticket",
      entityId: "7",
      action: "status_changed",
      actorId: "u_agent",
      actorName: "Aaron Agent",
      fromValue: "Open",
      toValue: "Resolved",
      createdAt: new Date("2026-08-24T09:00:00.000Z"),
    };

    expect(toActivityEntry(row)).toEqual({
      id: "ticket_activity:42",
      entityType: "ticket",
      entityId: "7",
      action: "status_changed",
      actorId: "u_agent",
      actorName: "Aaron Agent",
      fromValue: "Open",
      toValue: "Resolved",
      createdAt: "2026-08-24T09:00:00.000Z",
    });
  });

  test("preserves nulls rather than coercing them", () => {
    const row = {
      id: "automation_revision:3",
      entityType: "automation",
      entityId: null,
      action: "handoff_changed",
      actorId: null,
      actorName: "Ada Admin",
      fromValue: null,
      toValue: "admin",
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
    };

    const entry = toActivityEntry(row);
    expect(entry.entityId).toBeNull();
    expect(entry.actorId).toBeNull();
    expect(entry.fromValue).toBeNull();
  });
});

/* ── The route ───────────────────────────────────────────────────────────── */

const url = serveRouter("/api/activity", activityRouter);

interface Sent {
  status: number;
  body: {
    entries?: ActivityEntry[];
    total?: number;
    page?: number;
    pageSize?: number;
    error?: string;
  };
}

async function get(qs = ""): Promise<Sent> {
  const res = await fetch(url(qs ? `?${qs}` : ""));
  return { status: res.status, body: (await res.json()) as Sent["body"] };
}

/**
 * The feed, in the order it came back.
 *
 * Throws on a response that carries no `entries` rather than returning `[]`, so
 * a rejected query cannot read as "the filter excluded everything" — which is
 * the shape every negative assertion below takes.
 */
async function feed(qs = ""): Promise<ActivityEntry[]> {
  const sent = await get(qs);
  if (!sent.body.entries) {
    throw new Error(`no feed: ${sent.status} ${JSON.stringify(sent.body)}`);
  }
  return sent.body.entries;
}

/** The feed's ids — newest first, and unique across sources by construction. */
async function feedIds(qs = ""): Promise<string[]> {
  return (await feed(qs)).map((entry) => entry.id);
}

/* ── Fixtures ────────────────────────────────────────────────────────────── */

const TICKET_ID = 1;
const ARTICLE_ID = "KB-001";

/**
 * One instant per source, an hour apart, so "newest first" has exactly one
 * right answer and every test below can name it.
 */
const AT = {
  ticketActivity: new Date("2026-08-24T09:00:00.000Z"),
  reply: new Date("2026-08-24T10:00:00.000Z"),
  knowledge: new Date("2026-08-24T11:00:00.000Z"),
  admin: new Date("2026-08-24T12:00:00.000Z"),
  automation: new Date("2026-08-24T13:00:00.000Z"),
} as const;

/** The one article every knowledge revision hangs off. */
function seedArticle() {
  return prisma.knowledgeArticle.create({
    data: {
      id: ARTICLE_ID,
      title: "How do I reset my password?",
      category: TICKET_CATEGORY.Technical,
      body: "Use the 'forgot password' link on the sign-in page.",
    },
  });
}

/*
 * The five seeders below take the columns the feed reads and default the rest.
 */

/**
 * `??`, except that it only fills in for an *omitted* value.
 *
 * Null is a value these seeders have to be able to pass rather than a gap to
 * paper over — an automated reply has no author, a deleted account leaves every
 * actor column null behind a denormalised name, and a `created` entry has
 * nothing on either side of the move. Plain `??` would quietly hand back the
 * default for all three, which is a fixture silently seeding something other
 * than what the test asked for.
 */
function orDefault<T>(value: T | undefined, fallback: T): T {
  return value === undefined ? fallback : value;
}

function seedTicketActivity(
  over: {
    action?: TicketActivityAction;
    fromValue?: string | null;
    toValue?: string | null;
    actorId?: string | null;
    actorName?: string;
    createdAt?: Date;
  } = {},
) {
  return prisma.ticketActivity.create({
    data: {
      ticketId: TICKET_ID,
      action: over.action ?? TICKET_ACTIVITY_ACTION.status_changed,
      fromValue: orDefault(over.fromValue, "Open"),
      toValue: orDefault(over.toValue, "Resolved"),
      actorKind: TICKET_ACTOR_KIND.agent,
      actorId: orDefault(over.actorId, COLLEAGUE.agent.id),
      actorName: over.actorName ?? COLLEAGUE.agent.name,
      createdAt: over.createdAt ?? AT.ticketActivity,
    },
  });
}

/** A message on the thread. Outbound unless a test asks otherwise — the feed
 *  reads no other kind, which is itself worth a test. */
function seedMessage(
  over: {
    direction?: MessageDirection;
    authorId?: string | null;
    senderName?: string;
    createdAt?: Date;
  } = {},
) {
  return prisma.message.create({
    data: {
      ticketId: TICKET_ID,
      // The shape `outbound.ts` mints, and unique per row because
      // `Message.messageId` is UNIQUE in the schema.
      messageId: `${TICKET_ID}.${randomUUID()}@tickets.example.com`,
      senderEmail: COLLEAGUE.agent.email,
      senderName: over.senderName ?? COLLEAGUE.agent.name,
      textBody: "Try the reset link at the bottom of the sign-in page.",
      direction: over.direction ?? MESSAGE_DIRECTION.outbound,
      authorId: orDefault(over.authorId, COLLEAGUE.agent.id),
      createdAt: over.createdAt ?? AT.reply,
    },
  });
}

function seedKnowledgeRevision(
  over: {
    action?: KnowledgeRevisionAction;
    editorId?: string | null;
    editorName?: string;
    createdAt?: Date;
  } = {},
) {
  return prisma.knowledgeArticleRevision.create({
    data: {
      articleId: ARTICLE_ID,
      action: over.action ?? KNOWLEDGE_REVISION_ACTION.updated,
      title: "How do I reset my password?",
      category: TICKET_CATEGORY.Technical,
      body: "Use the 'forgot password' link on the sign-in page.",
      autoReply: false,
      archived: false,
      editorId: orDefault(over.editorId, COLLEAGUE.admin.id),
      editorName: over.editorName ?? COLLEAGUE.admin.name,
      editorEmail: COLLEAGUE.admin.email,
      createdAt: over.createdAt ?? AT.knowledge,
    },
  });
}

function seedAdminActivity(
  over: {
    action?: AdminActivityAction;
    actorId?: string | null;
    actorName?: string;
    targetUserId?: string | null;
    createdAt?: Date;
  } = {},
) {
  return prisma.adminActivity.create({
    data: {
      action: over.action ?? ADMIN_ACTIVITY_ACTION.role_changed,
      // A `role_changed` row's two sides are bare roles, so they come from
      // `USER_ROLE` rather than from a literal — `conventions.md`, and the
      // same way `routes/users.test.ts` writes the rows this reads back.
      fromValue: USER_ROLE.agent,
      toValue: USER_ROLE.admin,
      actorId: orDefault(over.actorId, COLLEAGUE.admin.id),
      actorName: over.actorName ?? COLLEAGUE.admin.name,
      actorEmail: COLLEAGUE.admin.email,
      targetUserId: orDefault(over.targetUserId, COLLEAGUE.other.id),
      targetUserName: COLLEAGUE.other.name,
      createdAt: over.createdAt ?? AT.admin,
    },
  });
}

function seedAutomationRevision(
  over: {
    fromTarget?: HandoffTarget;
    fromUserId?: string | null;
    fromUserName?: string | null;
    toTarget?: HandoffTarget;
    toUserId?: string | null;
    toUserName?: string | null;
    changedById?: string | null;
    changedByName?: string;
    createdAt?: Date;
  } = {},
) {
  return prisma.automationSettingsRevision.create({
    data: {
      fromTarget: over.fromTarget ?? HANDOFF_TARGET.admin,
      fromUserId: orDefault(over.fromUserId, null),
      fromUserName: orDefault(over.fromUserName, null),
      toTarget: over.toTarget ?? HANDOFF_TARGET.user,
      toUserId: orDefault(over.toUserId, COLLEAGUE.agent.id),
      toUserName: orDefault(over.toUserName, COLLEAGUE.agent.name),
      changedById: orDefault(over.changedById, COLLEAGUE.admin.id),
      changedByName: over.changedByName ?? COLLEAGUE.admin.name,
      createdAt: over.createdAt ?? AT.automation,
    },
  });
}

/** One row in each of the five sources, an hour apart. The starting position
 *  for every test about the merge itself. */
async function seedOnePerSource() {
  await seedTicketActivity();
  await seedMessage();
  await seedKnowledgeRevision();
  await seedAdminActivity();
  await seedAutomationRevision();
}

beforeEach(async () => {
  await resetDb();
  await seedColleagues("agent", "other", "admin");
  await seedTicket({ id: TICKET_ID });
  await seedArticle();
});

/* ── Validation ──────────────────────────────────────────────────────────── */

describe("query validation", () => {
  test("rejects an unknown entity type", async () => {
    const sent = await get("entityType=nonsense");

    expect(sent.status).toBe(400);
    expect(sent.body.error).toBe("Invalid entity type filter");
    expect(sent.body.entries).toBeUndefined();
  });

  test("rejects a non-numeric page", async () => {
    const sent = await get("page=abc");
    expect(sent.status).toBe(400);
  });

  test("rejects a page size over the ceiling", async () => {
    const sent = await get("pageSize=1000");
    expect(sent.status).toBe(400);
  });

  test("rejects a start date after the end date", async () => {
    const sent = await get("from=2026-08-20&to=2026-08-01");

    expect(sent.status).toBe(400);
    expect(sent.body.error).toBe("Start date must be before end date");
  });

  test("defaults page and pageSize when omitted", async () => {
    const sent = await get();

    expect(sent.body.page).toBe(FIRST_PAGE);
    expect(sent.body.pageSize).toBe(DEFAULT_PAGE_SIZE);
  });

  test("a deployment with no activity yet gets an empty feed, not an error", async () => {
    expect(await feedIds()).toEqual([]);
    expect((await get()).body.total).toBe(0);
  });
});

/* ── The merge ───────────────────────────────────────────────────────────── */

describe("the UNION ALL", () => {
  test("merges all five sources into one feed, newest first", async () => {
    await seedOnePerSource();

    // The assertion a stubbed `$queryRaw` could never make: five tables, one
    // sort, in the order the rows were written rather than in the order
    // `BRANCHES` lists them.
    expect(await feedIds()).toEqual([
      "automation_revision:1",
      "admin_activity:1",
      "knowledge_revision:1",
      "message:1",
      "ticket_activity:1",
    ]);
  });

  test("the source prefix is what keeps two tables' row 1 apart", async () => {
    await seedTicketActivity();
    await seedAdminActivity();

    // Both sequences are restarted by `resetDb`, so both of these rows really
    // are id 1 — the collision the prefix exists for, and one no fake client
    // handing back invented ids would ever produce.
    const ids = await feedIds();
    expect(ids).toEqual(["admin_activity:1", "ticket_activity:1"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("rows sharing an instant are ordered by id, so a page boundary holds still", async () => {
    await seedTicketActivity({ createdAt: AT.reply });
    await seedTicketActivity({ createdAt: AT.reply });

    // `"id" DESC` sorts the *prefixed* id, so this tie-break is lexical rather
    // than numeric. That is enough for what it is for — the order among ties
    // has only to be the same on the next request, or a row moves across a
    // page boundary while an admin is paging — and it is not a second sort
    // key anyone should read meaning into.
    expect(await feedIds()).toEqual(["ticket_activity:2", "ticket_activity:1"]);
  });

  test("the total counts every match, not the page in front of it", async () => {
    await seedOnePerSource();

    const sent = await get("pageSize=2");
    expect(sent.body.entries).toHaveLength(2);
    expect(sent.body.total).toBe(5);
  });

  test("pages walk the merged order without repeating or skipping a row", async () => {
    await seedOnePerSource();

    // Three pages over five rows, so the last one holds the odd row out —
    // which is where a LIMIT applied per branch rather than to the merge
    // would show up.
    expect(await feedIds("page=1&pageSize=2")).toEqual([
      "automation_revision:1",
      "admin_activity:1",
    ]);
    expect(await feedIds("page=2&pageSize=2")).toEqual([
      "knowledge_revision:1",
      "message:1",
    ]);
    expect(await feedIds("page=3&pageSize=2")).toEqual(["ticket_activity:1"]);
  });

  test("a page past the end is empty and still reports the total", async () => {
    await seedOnePerSource();

    const sent = await get("page=5");
    expect(sent.body.entries).toEqual([]);
    expect(sent.body.total).toBe(5);
  });

  test("the total and the pages it describes are the same set of rows", async () => {
    await seedOnePerSource();

    // The page and the count go through one `prisma.$transaction` so they
    // cannot describe different sets — the same reasoning `GET /api/tickets`
    // gives. The transaction itself is not observable from out here now that
    // the client is real; the drift it prevents is, so this walks every page
    // and checks the pieces add up to the number the first one reported.
    // (Before #171 this was `expect(transaction).toHaveBeenCalledTimes(1)`,
    // which was a fact about the stub rather than about the feed.)
    const total = (await get("pageSize=2")).body.total ?? 0;
    const seen: string[] = [];
    for (let page = 1; page <= total; page += 1) {
      const ids = await feedIds(`page=${page}&pageSize=2`);
      if (ids.length === 0) break;
      seen.push(...ids);
    }

    expect(seen).toHaveLength(total);
    expect(new Set(seen).size).toBe(total);
  });
});

/* ── What each branch makes of its own table ─────────────────────────────── */

describe("each source is shaped onto the wire", () => {
  test("a ticket activity row keeps its action and both sides of the move", async () => {
    await seedTicketActivity({
      action: TICKET_ACTIVITY_ACTION.category_changed,
      fromValue: null,
      toValue: "Technical",
    });

    expect(await feed()).toEqual([
      {
        id: "ticket_activity:1",
        entityType: ACTIVITY_ENTITY_TYPE.ticket,
        // The ticket's numeric id, cast to text by the branch — the column
        // every other source fills with a string of its own.
        entityId: String(TICKET_ID),
        action: TICKET_ACTIVITY_ACTION.category_changed,
        actorId: COLLEAGUE.agent.id,
        actorName: COLLEAGUE.agent.name,
        fromValue: null,
        toValue: "Technical",
        createdAt: AT.ticketActivity.toISOString(),
      },
    ]);
  });

  test("an outbound reply becomes the activity row it never gets one of", async () => {
    await seedMessage();

    // `reply_sent` is synthesised by the branch — there is no such column
    // anywhere in `message` — and the byline is the pair `outbound.ts` writes.
    expect(await feed()).toEqual([
      {
        id: "message:1",
        entityType: ACTIVITY_ENTITY_TYPE.ticket,
        entityId: String(TICKET_ID),
        action: "reply_sent",
        actorId: COLLEAGUE.agent.id,
        actorName: COLLEAGUE.agent.name,
        fromValue: null,
        toValue: null,
        createdAt: AT.reply.toISOString(),
      },
    ]);
  });

  test("inbound mail never reaches the feed", async () => {
    await seedMessage({
      direction: MESSAGE_DIRECTION.inbound,
      authorId: null,
      senderName: "Marta",
    });

    // The one branch whose `WHERE` is mandatory rather than a filter: what a
    // customer sent is the ticket, not something that happened to it.
    expect(await feedIds()).toEqual([]);
  });

  test("a knowledge revision is filed under its article's string id", async () => {
    await seedKnowledgeRevision({ action: KNOWLEDGE_REVISION_ACTION.archived });

    expect(await feed()).toEqual([
      {
        id: "knowledge_revision:1",
        entityType: ACTIVITY_ENTITY_TYPE.knowledge,
        entityId: ARTICLE_ID,
        action: KNOWLEDGE_REVISION_ACTION.archived,
        actorId: COLLEAGUE.admin.id,
        actorName: COLLEAGUE.admin.name,
        // A revision is a whole snapshot, so there is no transition to show.
        fromValue: null,
        toValue: null,
        createdAt: AT.knowledge.toISOString(),
      },
    ]);
  });

  test("an admin activity row is filed under the account it acted on", async () => {
    await seedAdminActivity();

    expect(await feed()).toEqual([
      {
        id: "admin_activity:1",
        entityType: ACTIVITY_ENTITY_TYPE.admin,
        // The target, not the actor — the actor is the byline beside it.
        entityId: COLLEAGUE.other.id,
        action: ADMIN_ACTIVITY_ACTION.role_changed,
        actorId: COLLEAGUE.admin.id,
        actorName: COLLEAGUE.admin.name,
        fromValue: USER_ROLE.agent,
        toValue: USER_ROLE.admin,
        createdAt: AT.admin.toISOString(),
      },
    ]);
  });

  test("a handoff change to a person reads as that person's name", async () => {
    await seedAutomationRevision({
      fromTarget: HANDOFF_TARGET.admin,
      toTarget: HANDOFF_TARGET.user,
      toUserId: COLLEAGUE.agent.id,
      toUserName: COLLEAGUE.agent.name,
    });

    expect(await feed()).toEqual([
      {
        id: "automation_revision:1",
        entityType: ACTIVITY_ENTITY_TYPE.automation,
        // One system-wide setting, so there is no record to point at.
        entityId: null,
        action: "handoff_changed",
        actorId: COLLEAGUE.admin.id,
        actorName: COLLEAGUE.admin.name,
        // The `CASE`, executed: the bare target on the left, the named person
        // on the right, decided per side rather than per row.
        fromValue: HANDOFF_TARGET.admin,
        toValue: COLLEAGUE.agent.name,
        createdAt: AT.automation.toISOString(),
      },
    ]);
  });

  test("a handoff change away from a person reads the name on the other side", async () => {
    await seedAutomationRevision({
      fromTarget: HANDOFF_TARGET.user,
      fromUserId: COLLEAGUE.agent.id,
      fromUserName: COLLEAGUE.agent.name,
      toTarget: HANDOFF_TARGET.unassigned,
      toUserId: null,
      toUserName: null,
    });

    // The mirror image of the test above, and both are needed: a `CASE` that
    // read the same side twice would pass one of them.
    const [entry] = await feed();
    expect(entry.fromValue).toBe(COLLEAGUE.agent.name);
    expect(entry.toValue).toBe(HANDOFF_TARGET.unassigned);
  });
});

/* ── entityType ──────────────────────────────────────────────────────────── */

describe("entityType narrows the feed to one kind of thing", () => {
  beforeEach(seedOnePerSource);

  test("no filter includes every source", async () => {
    expect(await feedIds()).toHaveLength(5);
  });

  test("ticket names two sources, because two of them describe a ticket", async () => {
    expect(await feedIds(`entityType=${ACTIVITY_ENTITY_TYPE.ticket}`)).toEqual([
      "message:1",
      "ticket_activity:1",
    ]);
  });

  test("knowledge, admin and automation each name one", async () => {
    expect(
      await feedIds(`entityType=${ACTIVITY_ENTITY_TYPE.knowledge}`),
    ).toEqual(["knowledge_revision:1"]);
    expect(await feedIds(`entityType=${ACTIVITY_ENTITY_TYPE.admin}`)).toEqual([
      "admin_activity:1",
    ]);
    expect(
      await feedIds(`entityType=${ACTIVITY_ENTITY_TYPE.automation}`),
    ).toEqual(["automation_revision:1"]);
  });

  test("the total is the filtered total, not the whole feed's", async () => {
    const sent = await get(`entityType=${ACTIVITY_ENTITY_TYPE.admin}`);
    expect(sent.body.total).toBe(1);
  });
});

/* ── actorId ─────────────────────────────────────────────────────────────── */

describe("actorId asks each source for its own actor column", () => {
  test("one filter reaches four differently-named columns", async () => {
    // The agent acted once in each source — `ta.actorId`, `m.authorId`,
    // `kar.editorId`, `aa.actorId` and `asr.changedById`. Naming those from
    // one query parameter is what this filter *is*; counting five identical
    // bind values, which is all the old stub could do, would pass just as
    // happily with the same column named five times over.
    await seedTicketActivity({
      actorId: COLLEAGUE.agent.id,
      actorName: COLLEAGUE.agent.name,
    });
    await seedMessage({ authorId: COLLEAGUE.agent.id });
    await seedKnowledgeRevision({
      editorId: COLLEAGUE.agent.id,
      editorName: COLLEAGUE.agent.name,
    });
    await seedAdminActivity({
      actorId: COLLEAGUE.agent.id,
      actorName: COLLEAGUE.agent.name,
    });
    await seedAutomationRevision({
      changedById: COLLEAGUE.agent.id,
      changedByName: COLLEAGUE.agent.name,
    });

    expect(await feedIds(`actorId=${COLLEAGUE.agent.id}`)).toEqual([
      "automation_revision:1",
      "admin_activity:1",
      "knowledge_revision:1",
      "message:1",
      "ticket_activity:1",
    ]);
  });

  test("somebody else's rows stay out of it", async () => {
    await seedTicketActivity({
      actorId: COLLEAGUE.agent.id,
      actorName: COLLEAGUE.agent.name,
    });
    await seedAdminActivity({
      actorId: COLLEAGUE.admin.id,
      actorName: COLLEAGUE.admin.name,
    });

    const sent = await get(`actorId=${COLLEAGUE.agent.id}`);
    expect(sent.body.entries?.map((e) => e.id)).toEqual(["ticket_activity:1"]);
    expect(sent.body.total).toBe(1);
  });

  test("being the account acted *on* is not being the actor", async () => {
    await seedAdminActivity({
      actorId: COLLEAGUE.admin.id,
      actorName: COLLEAGUE.admin.name,
      targetUserId: COLLEAGUE.agent.id,
    });

    // `admin_activity` is the one source with two user columns, and the feed
    // filters the one that acted. An agent's own trail must not include the
    // day somebody else changed their role.
    expect(await feedIds(`actorId=${COLLEAGUE.agent.id}`)).toEqual([]);
  });

  test("an automated reply has no actor, so no actor filter finds it", async () => {
    await seedMessage({ authorId: null, senderName: "Support (automated)" });

    // A null `authorId` is what "nobody wrote this" looks like in the column
    // the filter reads — see `ActivityEntry`'s own note. The reply is still in
    // the unfiltered feed, with its byline intact.
    expect(await feedIds(`actorId=${COLLEAGUE.agent.id}`)).toEqual([]);
    expect(await feed()).toMatchObject([
      { id: "message:1", actorId: null, actorName: "Support (automated)" },
    ]);
  });

  test("an actor id carrying a quote is a value, not query text", async () => {
    await seedOnePerSource();

    // `actorId` is the one filter that reaches five hand-written `WHERE`
    // clauses, so it is the one worth proving is bound rather than
    // concatenated. Spliced in, this closes the string literal and re-opens a
    // predicate that is true of every row — so the tell is not an error, it is
    // the whole feed coming back. Nobody has this id, so the only right answer
    // is nothing at all.
    //
    // Replaces the old `expect(text).not.toContain("u_someone")`, which read
    // the query string the stub was handed. Postgres is the one being asked
    // now, which is the only place the answer was ever decided.
    const injected = encodeURIComponent(`${COLLEAGUE.agent.id}' OR '1'='1`);
    expect(await feedIds(`actorId=${injected}`)).toEqual([]);
  });
});

/* ── The date window ─────────────────────────────────────────────────────── */

describe("from and to bound the window Postgres compares against", () => {
  beforeEach(seedOnePerSource);

  test("from is inclusive and to is exclusive, on the instant", async () => {
    // The rows sit an hour apart from 09:00 to 13:00. Asking for exactly 10:00
    // to 12:00 has to keep 10:00 and 11:00 and drop 12:00 — the `>=` / `<`
    // pair in `dateFilter`, executed rather than read off a query string.
    expect(
      await feedIds(
        "from=2026-08-24T10:00:00.000Z&to=2026-08-24T12:00:00.000Z",
      ),
    ).toEqual(["knowledge_revision:1", "message:1"]);
  });

  test("a window is applied to every branch, not only the first", async () => {
    const sent = await get("from=2026-08-24T11:00:00.000Z");

    expect(sent.body.entries?.map((e) => e.id)).toEqual([
      "automation_revision:1",
      "admin_activity:1",
      "knowledge_revision:1",
    ]);
    expect(sent.body.total).toBe(3);
  });

  test("a date with no time is read as UTC midnight, not the server's", async () => {
    // What `ts()`'s `::timestamptz AT TIME ZONE 'UTC'` is for. `2026-08-24`
    // coerces to midnight UTC, so the whole day is in and the day after it is
    // a window that has already closed. On a machine an hour either side of
    // UTC, a cast that took the local zone would keep or drop the 09:00 row.
    expect(await feedIds("from=2026-08-24&to=2026-08-25")).toHaveLength(5);
    expect(await feedIds("from=2026-08-25")).toEqual([]);
    expect(await feedIds("to=2026-08-24")).toEqual([]);
  });

  test("the window and the entity type narrow together", async () => {
    expect(
      await feedIds(
        `entityType=${ACTIVITY_ENTITY_TYPE.ticket}&from=2026-08-24T10:00:00.000Z`,
      ),
    ).toEqual(["message:1"]);
  });
});
