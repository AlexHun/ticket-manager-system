import type { Request, Response } from "express";
import { ticketStatsQuerySchema } from "@ticket/core";
import {
  AGE_BUCKET,
  DASHBOARD_RANGE_BUCKET,
  DASHBOARD_RANGE_DAYS,
  DASHBOARD_SCOPE,
  LATENCY_BUCKET,
  MESSAGE_DIRECTION,
  TICKET_CATEGORY,
  TICKET_STATUS,
  TOP_CUSTOMERS_LIMIT,
  NEEDS_ATTENTION_LIMIT,
  WORKLOAD_AGENT_LIMIT,
  type AgentWorkload,
  type DashboardBucket,
  type TicketCategoryCount,
  type TicketStatsResponse,
} from "@ticket/shared";
import { Prisma, prisma } from "../db";
import { sessionOf } from "../middleware/auth";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `generate_series` step per bucket width. Like `ORDER_BY` in `tickets.ts`, the
 * client's validated enum only ever *selects* one of these — no part of a
 * request is spliced into SQL.
 */
const BUCKET_STEP: Record<DashboardBucket, string> = {
  day: "1 day",
  week: "1 week",
  month: "1 month",
};

/**
 * Every ticket timestamp is `timestamp(3)` *without* time zone, which Prisma
 * writes in UTC. A `Date` sent as a plain bind parameter can be rendered by the
 * driver with its local offset, and Postgres discards that offset when parsing
 * into a naive column — so the whole dashboard silently shifts by the API host's
 * UTC offset (invisible on a UTC server, wrong on a laptop in CET).
 *
 * Casting to `timestamptz` first makes the trailing `Z` meaningful, and
 * `AT TIME ZONE 'UTC'` converts back to the same naive UTC clock the column is
 * stored on. For the same reason nothing below calls `now()`: it returns
 * `timestamptz`, and mixing it with a naive column drags the session's TimeZone
 * setting into the arithmetic.
 */
const ts = (d: Date) =>
  Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

/** Raw-row shapes. Declared beside each query because `$queryRaw<T[]>` is an
 *  unchecked cast: rename an alias and TypeScript stays happy while the field
 *  goes `undefined` at runtime. Each is mapped field-by-field into the response. */
interface FactsRow {
  total: number;
  open: number;
  resolved: number;
  closed: number;
  openUnassigned: number;
  general: number;
  technical: number;
  refund: number;
  other: number;
  uncategorised: number;
}

interface VolumeRow {
  bucketStart: string;
  Open: number;
  Resolved: number;
  Closed: number;
}

interface LatencyRow {
  responded: number;
  awaiting: number;
  under1h: number;
  h1to4: number;
  h4to24: number;
  over24h: number;
  medianHours: number | null;
  p90Hours: number | null;
}

interface AgeRow {
  open: number;
  under1d: number;
  d1to3: number;
  d3to7: number;
  over7d: number;
  medianAgeHours: number | null;
}

interface WorkloadRow {
  id: string | null;
  name: string | null;
  Open: number;
  Resolved: number;
  Closed: number;
  total: number;
}

interface CustomerRow {
  email: string;
  name: string;
  total: number;
  open: number;
  lastMessageAt: Date;
}

/**
 * GET /api/tickets/stats
 *
 * One endpoint for the whole dashboard rather than one per panel: the range and
 * scope controls scope every panel at once, so separate requests would land at
 * separate moments and leave the KPI row describing a different slice than the
 * chart beside it. One transaction, one loading state, one auth check.
 *
 * Every metric here is derived from columns that exist. There is no `resolvedAt`
 * and `updatedAt` bumps on any PATCH, so resolution *time* is deliberately
 * absent rather than approximated by something that would read as a measurement
 * and isn't one.
 *
 * The aggregates below all range-scan `ticket.createdAt`, and the first-response
 * query wants the earliest outbound message per ticket. Both are indexed for —
 * `ticket(createdAt)`, `ticket(status, createdAt)` and
 * `message(ticketId, direction, createdAt)`, added in
 * `add_ticket_stats_indexes`. A new panel that scopes on a different column
 * needs the same treatment; see the comments in `schema.prisma` for which query
 * each index is shaped around.
 *
 * The eight queries run sequentially inside one transaction, so this endpoint's
 * latency is their sum. That is the price of the consistency described above.
 */
export async function ticketStatsHandler(
  req: Request,
  res: Response<TicketStatsResponse | { error: string }>,
): Promise<void> {
  const parsed = ticketStatsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  const { range, scope } = parsed.data;
  const session = sessionOf(res);
  const bucket = DASHBOARD_RANGE_BUCKET[range];
  const days = DASHBOARD_RANGE_DAYS[range];

  // The window is pinned once and every panel measures against these two
  // instants, so the response is internally consistent and reproducible.
  const to = new Date();
  const from = new Date(to.getTime() - days * DAY_MS);
  const previousFrom = new Date(from.getTime() - days * DAY_MS);

  const LO = ts(from);
  const HI = ts(to);

  // The caller's own id, as a bind parameter — never concatenated, and never
  // taken from the request, so `scope=mine` can't be pointed at a colleague.
  const isMine = scope === DASHBOARD_SCOPE.mine;
  const mine = isMine
    ? Prisma.sql`AND t."assignedToId" = ${session.user.id}`
    : Prisma.empty;

  /** The window predicate, written once and interpolated into every raw query
   *  below. Its Prisma-API twin is `sliceWhere` — keep the two in step. */
  const slice = Prisma.sql`t."createdAt" >= ${LO} AND t."createdAt" < ${HI} ${mine}`;
  const sliceWhere = {
    createdAt: { gte: from, lt: to },
    ...(isMine ? { assignedToId: session.user.id } : {}),
  };

  // Three casting rules hold throughout the SQL below, each of which is a
  // runtime failure rather than a type error if forgotten:
  //   COUNT(...)::int      — Postgres count is bigint, which the pg adapter
  //                          hands back as a JS BigInt, and res.json() throws
  //                          "Do not know how to serialize a BigInt".
  //   EXTRACT(EPOCH ...)::float8 — numeric on PG14+, which arrives as a Decimal
  //                          object and serialises to {s,e,d} garbage.
  //   ::"TicketStatus" etc — the enum values travel as bind parameters (so the
  //                          @ticket/shared constants stay the single source of
  //                          truth), and an untyped parameter compared to an
  //                          enum column is `operator does not exist`.
  // "user" is also a reserved word, so it is always double-quoted.

  const factsSql = Prisma.sql`
    SELECT
      COUNT(*)::int AS "total",
      COUNT(*) FILTER (WHERE t.status = ${TICKET_STATUS.Open}::"TicketStatus")::int AS "open",
      COUNT(*) FILTER (WHERE t.status = ${TICKET_STATUS.Resolved}::"TicketStatus")::int AS "resolved",
      COUNT(*) FILTER (WHERE t.status = ${TICKET_STATUS.Closed}::"TicketStatus")::int AS "closed",
      COUNT(*) FILTER (
        WHERE t.status = ${TICKET_STATUS.Open}::"TicketStatus" AND t."assignedToId" IS NULL
      )::int AS "openUnassigned",
      COUNT(*) FILTER (WHERE t.category = ${TICKET_CATEGORY.General}::"TicketCategory")::int AS "general",
      COUNT(*) FILTER (WHERE t.category = ${TICKET_CATEGORY.Technical}::"TicketCategory")::int AS "technical",
      COUNT(*) FILTER (WHERE t.category = ${TICKET_CATEGORY.Refund}::"TicketCategory")::int AS "refund",
      COUNT(*) FILTER (WHERE t.category = ${TICKET_CATEGORY.Other}::"TicketCategory")::int AS "other",
      COUNT(*) FILTER (WHERE t.category IS NULL)::int AS "uncategorised"
    FROM "ticket" t
    WHERE ${slice}
  `;

  // `generate_series` is load-bearing, not defensive: without it a quiet week is
  // simply not a row, and the chart draws a continuous series that lies about
  // cadence. The bucket start is returned as a plain YYYY-MM-DD string because
  // an ISO instant re-parsed west of Greenwich renders as the previous day.
  const volumeSql = Prisma.sql`
    WITH buckets AS (
      SELECT generate_series(
               date_trunc(${bucket}::text, ${LO}),
               date_trunc(${bucket}::text, ${HI}),
               ${BUCKET_STEP[bucket]}::interval
             ) AS bucket
    ),
    counted AS (
      SELECT date_trunc(${bucket}::text, t."createdAt") AS bucket,
             t.status AS status,
             COUNT(*)::int AS count
      FROM "ticket" t
      WHERE ${slice}
      GROUP BY 1, 2
    )
    SELECT
      to_char(b.bucket, 'YYYY-MM-DD') AS "bucketStart",
      COALESCE(SUM(c.count) FILTER (WHERE c.status = ${TICKET_STATUS.Open}::"TicketStatus"), 0)::int AS "Open",
      COALESCE(SUM(c.count) FILTER (WHERE c.status = ${TICKET_STATUS.Resolved}::"TicketStatus"), 0)::int AS "Resolved",
      COALESCE(SUM(c.count) FILTER (WHERE c.status = ${TICKET_STATUS.Closed}::"TicketStatus"), 0)::int AS "Closed"
    FROM buckets b
    LEFT JOIN counted c ON c.bucket = b.bucket
    GROUP BY b.bucket
    ORDER BY b.bucket
  `;

  // LEFT JOIN LATERAL ... LIMIT 1 rides the existing message(ticketId, createdAt)
  // index and stops at the first outbound message. LEFT rather than inner so
  // never-answered tickets survive as a NULL: that is how `awaiting` is counted,
  // and it is what stops the median from lying — forty minutes across the
  // tickets someone answered is not a good number if twice as many were ignored.
  //
  // The CASE is not decoration: GREATEST ignores NULLs in Postgres, so a bare
  // GREATEST(..., 0) would score every unanswered ticket as an instant reply.
  const latencySql = Prisma.sql`
    WITH scoped AS (
      SELECT t.id, t."createdAt"
      FROM "ticket" t
      WHERE ${slice}
    ),
    latency AS (
      SELECT
        CASE
          WHEN fr."createdAt" IS NULL THEN NULL
          ELSE GREATEST(
            EXTRACT(EPOCH FROM (fr."createdAt" - s."createdAt"))::float8 / 3600.0,
            0
          )
        END AS hours
      FROM scoped s
      LEFT JOIN LATERAL (
        SELECT m."createdAt"
        FROM "message" m
        WHERE m."ticketId" = s.id
          AND m.direction = ${MESSAGE_DIRECTION.outbound}::"MessageDirection"
        ORDER BY m."createdAt" ASC, m.id ASC
        LIMIT 1
      ) fr ON TRUE
    )
    SELECT
      COUNT(hours)::int AS "responded",
      COUNT(*) FILTER (WHERE hours IS NULL)::int AS "awaiting",
      COUNT(*) FILTER (WHERE hours < 1)::int AS "under1h",
      COUNT(*) FILTER (WHERE hours >= 1 AND hours < 4)::int AS "h1to4",
      COUNT(*) FILTER (WHERE hours >= 4 AND hours < 24)::int AS "h4to24",
      COUNT(*) FILTER (WHERE hours >= 24)::int AS "over24h",
      percentile_cont(0.5) WITHIN GROUP (ORDER BY hours) AS "medianHours",
      percentile_cont(0.9) WITHIN GROUP (ORDER BY hours) AS "p90Hours"
    FROM latency
  `;

  const ageSql = Prisma.sql`
    SELECT
      COUNT(*)::int AS "open",
      COUNT(*) FILTER (WHERE age < 24)::int AS "under1d",
      COUNT(*) FILTER (WHERE age >= 24 AND age < 72)::int AS "d1to3",
      COUNT(*) FILTER (WHERE age >= 72 AND age < 168)::int AS "d3to7",
      COUNT(*) FILTER (WHERE age >= 168)::int AS "over7d",
      percentile_cont(0.5) WITHIN GROUP (ORDER BY age) AS "medianAgeHours"
    FROM (
      SELECT EXTRACT(EPOCH FROM (${HI} - t."createdAt"))::float8 / 3600.0 AS age
      FROM "ticket" t
      WHERE t.status = ${TICKET_STATUS.Open}::"TicketStatus"
        AND ${slice}
    ) a
  `;

  const scopeUser = isMine
    ? Prisma.sql`AND u.id = ${session.user.id}`
    : Prisma.empty;

  // Two things here are easy to get wrong and both are silent:
  //   COUNT(s.id), never COUNT(*) — over the LEFT JOIN an agent with no tickets
  //     produces one all-NULL row, which COUNT(*) would score as 1.
  //   The window predicate stays inside `scoped`, i.e. effectively in the join
  //     condition. Moved to the outer WHERE, zero-ticket agents vanish — which
  //     is precisely the information this panel exists to show.
  const workloadSql = Prisma.sql`
    WITH scoped AS (
      SELECT t.id, t.status, t."assignedToId"
      FROM "ticket" t
      WHERE ${slice}
    ),
    rows AS (
      SELECT
        u.id AS "id",
        u.name AS "name",
        COUNT(s.id) FILTER (WHERE s.status = ${TICKET_STATUS.Open}::"TicketStatus")::int AS "Open",
        COUNT(s.id) FILTER (WHERE s.status = ${TICKET_STATUS.Resolved}::"TicketStatus")::int AS "Resolved",
        COUNT(s.id) FILTER (WHERE s.status = ${TICKET_STATUS.Closed}::"TicketStatus")::int AS "Closed",
        COUNT(s.id)::int AS "total"
      FROM "user" u
      LEFT JOIN scoped s ON s."assignedToId" = u.id
      WHERE u."deletedAt" IS NULL ${scopeUser}
      GROUP BY u.id, u.name

      UNION ALL

      SELECT
        NULL::text,
        NULL::text,
        COUNT(s.id) FILTER (WHERE s.status = ${TICKET_STATUS.Open}::"TicketStatus")::int,
        COUNT(s.id) FILTER (WHERE s.status = ${TICKET_STATUS.Resolved}::"TicketStatus")::int,
        COUNT(s.id) FILTER (WHERE s.status = ${TICKET_STATUS.Closed}::"TicketStatus")::int,
        COUNT(s.id)::int
      FROM scoped s
      WHERE s."assignedToId" IS NULL
    )
    SELECT * FROM rows
    ORDER BY ("id" IS NULL), "total" DESC, "name" ASC
  `;

  // ARRAY_AGG(... ORDER BY createdAt DESC)[1] rather than MAX(name): the same
  // address arrives under several spellings and the alphabetically-largest one
  // is meaningless — the most recent is the one an agent recognises.
  const customersSql = Prisma.sql`
    SELECT
      t."customerEmail" AS "email",
      (ARRAY_AGG(t."customerName" ORDER BY t."createdAt" DESC, t.id DESC))[1] AS "name",
      COUNT(*)::int AS "total",
      COUNT(*) FILTER (WHERE t.status = ${TICKET_STATUS.Open}::"TicketStatus")::int AS "open",
      MAX(t."lastMessageAt") AS "lastMessageAt"
    FROM "ticket" t
    WHERE ${slice}
    GROUP BY t."customerEmail"
    ORDER BY "total" DESC, MAX(t."lastMessageAt") DESC
    LIMIT ${TOP_CUSTOMERS_LIMIT}
  `;

  const [facts, volume, latency, age, workload, customers, attention, previousTotal] =
    await prisma.$transaction([
      prisma.$queryRaw<FactsRow[]>(factsSql),
      prisma.$queryRaw<VolumeRow[]>(volumeSql),
      prisma.$queryRaw<LatencyRow[]>(latencySql),
      prisma.$queryRaw<AgeRow[]>(ageSql),
      prisma.$queryRaw<WorkloadRow[]>(workloadSql),
      prisma.$queryRaw<CustomerRow[]>(customersSql),
      prisma.ticket.findMany({
        where: { status: TICKET_STATUS.Open, ...sliceWhere },
        // Longest silence first; id breaks ties because seeded threads share an
        // instant and an unstable order would reshuffle the card between loads.
        orderBy: [{ lastMessageAt: "asc" }, { id: "asc" }],
        take: NEEDS_ATTENTION_LIMIT,
        select: {
          id: true,
          subject: true,
          customerName: true,
          lastMessageAt: true,
          createdAt: true,
          assignedTo: { select: { id: true, name: true, email: true } },
          // Only the direction of the newest message: if the customer had the
          // last word — or nobody has said anything — the ball is on our side.
          messages: {
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1,
            select: { direction: true },
          },
        },
      }),
      prisma.ticket.count({
        where: {
          createdAt: { gte: previousFrom, lt: from },
          ...(isMine ? { assignedToId: session.user.id } : {}),
        },
      }),
    ]);

  // Each raw query is an aggregate with no GROUP BY, so it always returns
  // exactly one row — but reading [0] off an empty array would be `undefined`,
  // so each falls back to a zeroed shape rather than throwing on a NULL slice.
  const f = facts[0];
  const l = latency[0];
  const a = age[0];

  const total = f?.total ?? 0;
  const settled = (f?.resolved ?? 0) + (f?.closed ?? 0);

  const categories: TicketCategoryCount[] = [
    { category: TICKET_CATEGORY.General, count: f?.general ?? 0 },
    { category: TICKET_CATEGORY.Technical, count: f?.technical ?? 0 },
    { category: TICKET_CATEGORY.Refund, count: f?.refund ?? 0 },
    { category: TICKET_CATEGORY.Other, count: f?.other ?? 0 },
    { category: null, count: f?.uncategorised ?? 0 },
  ];

  // The unassigned row is not a person, so it is split off rather than competing
  // for a slot in the top-N agents.
  const unassignedRow = workload.find((r) => r.id === null);
  const agents: AgentWorkload[] = workload
    .filter((r): r is WorkloadRow & { id: string; name: string } => r.id !== null)
    .slice(0, WORKLOAD_AGENT_LIMIT)
    .map((r) => ({
      id: r.id,
      name: r.name,
      [TICKET_STATUS.Open]: r.Open,
      [TICKET_STATUS.Resolved]: r.Resolved,
      [TICKET_STATUS.Closed]: r.Closed,
      total: r.total,
    }));

  res.json({
    range,
    scope,
    bucket,
    from: from.toISOString(),
    to: to.toISOString(),
    summary: {
      total,
      previousTotal,
      byStatus: {
        [TICKET_STATUS.Open]: f?.open ?? 0,
        [TICKET_STATUS.Resolved]: f?.resolved ?? 0,
        [TICKET_STATUS.Closed]: f?.closed ?? 0,
      },
      openUnassigned: f?.openUnassigned ?? 0,
      settledShare: total === 0 ? 0 : settled / total,
    },
    volume: volume.map((v) => ({
      bucketStart: v.bucketStart,
      [TICKET_STATUS.Open]: v.Open,
      [TICKET_STATUS.Resolved]: v.Resolved,
      [TICKET_STATUS.Closed]: v.Closed,
    })),
    categories,
    firstResponse: {
      responded: l?.responded ?? 0,
      awaiting: l?.awaiting ?? 0,
      medianHours: l?.medianHours ?? null,
      p90Hours: l?.p90Hours ?? null,
      buckets: {
        [LATENCY_BUCKET.under1h]: l?.under1h ?? 0,
        [LATENCY_BUCKET.h1to4]: l?.h1to4 ?? 0,
        [LATENCY_BUCKET.h4to24]: l?.h4to24 ?? 0,
        [LATENCY_BUCKET.over24h]: l?.over24h ?? 0,
      },
    },
    backlogAge: {
      open: a?.open ?? 0,
      medianAgeHours: a?.medianAgeHours ?? null,
      buckets: {
        [AGE_BUCKET.under1d]: a?.under1d ?? 0,
        [AGE_BUCKET.d1to3]: a?.d1to3 ?? 0,
        [AGE_BUCKET.d3to7]: a?.d3to7 ?? 0,
        [AGE_BUCKET.over7d]: a?.over7d ?? 0,
      },
    },
    workload: agents,
    unassigned: {
      [TICKET_STATUS.Open]: unassignedRow?.Open ?? 0,
      [TICKET_STATUS.Resolved]: unassignedRow?.Resolved ?? 0,
      [TICKET_STATUS.Closed]: unassignedRow?.Closed ?? 0,
      total: unassignedRow?.total ?? 0,
    },
    topCustomers: customers.map((c) => ({
      email: c.email,
      name: c.name,
      total: c.total,
      open: c.open,
      lastMessageAt: c.lastMessageAt.toISOString(),
    })),
    needsAttention: attention.map((t) => ({
      id: t.id,
      subject: t.subject,
      customerName: t.customerName,
      assignedTo: t.assignedTo,
      lastMessageAt: t.lastMessageAt.toISOString(),
      createdAt: t.createdAt.toISOString(),
      waitingOnUs:
        t.messages.length === 0 ||
        t.messages[0].direction === MESSAGE_DIRECTION.inbound,
    })),
  });
}
