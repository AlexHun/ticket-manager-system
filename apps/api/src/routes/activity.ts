import { Router } from "express";
import type { Request, Response } from "express";
import { activityQuerySchema } from "@ticket/core";
import {
  ACTIVITY_ENTITY_TYPE,
  HANDOFF_TARGET,
  MESSAGE_DIRECTION,
  type ActivityAction,
  type ActivityEntityType,
  type ActivityEntry,
  type ActivityFeedResponse,
} from "@ticket/shared";
import { Prisma, prisma } from "../db";
import { requireAdmin } from "../middleware/auth";

/**
 * `GET /api/activity` — the unified admin activity feed.
 *
 * A query-time merge of five sources, never a sixth table: `TicketActivity`,
 * `KnowledgeArticleRevision`, `AdminActivity`, `AutomationSettingsRevision`,
 * and outbound replies read straight off `Message` (`direction: outbound`),
 * which has no activity row of its own anywhere today. See `ActivityEntry`
 * in `@ticket/shared` for the wire shape and why a sent reply is filed under
 * the `ticket` entity type rather than getting one of its own.
 *
 * **One `UNION ALL`, not five Prisma queries stitched together.** Five
 * separate `findMany` calls would each need their own `page * pageSize` rows
 * fetched to be certain the true top-N survives the merge — none of the
 * five is sorted by anything else, so there is no way to ask any of them for
 * fewer than "everything before the merged cutoff" without already knowing
 * where that cutoff falls. A single `SELECT * FROM (…) ORDER BY … LIMIT …`
 * lets Postgres do that sort once, over rows already narrowed by whichever
 * filters apply — and `entityType` narrows further still: naming one skips
 * building the other branches at all, rather than fetching and discarding
 * them.
 *
 * Every branch below shares one shape — `id`, `entityType`, `entityId`,
 * `action`, `actorId`, `actorName`, `fromValue`, `toValue`, `createdAt` — so
 * the outer query can treat all five as one table. `id` is prefixed per
 * source (`"ticket_activity:42"`) because the five id sequences are
 * independent and would otherwise collide across sources.
 */

const ts = (d: Date) =>
  Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

/** The three filters every branch below applies identically, if present. */
interface FeedFilters {
  actorId?: string;
  from?: Date;
  to?: Date;
}

/**
 * The window predicate, appended to whichever branch already has at least
 * one condition in its `WHERE` — every branch does, either the mandatory
 * `direction = 'outbound'` on `message` or a `WHERE TRUE` on the other four,
 * so this never has to open with `AND` on its own.
 */
function dateFilter(column: Prisma.Sql, f: FeedFilters): Prisma.Sql {
  return Prisma.sql`
    ${f.from ? Prisma.sql`AND ${column} >= ${ts(f.from)}` : Prisma.empty}
    ${f.to ? Prisma.sql`AND ${column} < ${ts(f.to)}` : Prisma.empty}
  `;
}

/**
 * A ticket's own trail: status, category and assignee moves, reopens, and
 * the two verdicts the auto-reply can reach.
 */
function ticketActivityBranch(f: FeedFilters): Prisma.Sql {
  return Prisma.sql`
    SELECT
      'ticket_activity:' || ta.id::text AS "id",
      ${ACTIVITY_ENTITY_TYPE.ticket}::text AS "entityType",
      ta."ticketId"::text AS "entityId",
      ta.action::text AS "action",
      ta."actorId" AS "actorId",
      ta."actorName" AS "actorName",
      ta."fromValue" AS "fromValue",
      ta."toValue" AS "toValue",
      ta."createdAt" AS "createdAt"
    FROM "ticket_activity" ta
    WHERE TRUE
      ${f.actorId ? Prisma.sql`AND ta."actorId" = ${f.actorId}` : Prisma.empty}
      ${dateFilter(Prisma.sql`ta."createdAt"`, f)}
  `;
}

/**
 * A sent reply, standing in for the activity row it never gets one of its
 * own. `authorId`/`senderName` are the same pair `outbound.ts` writes a
 * reply's byline from — null and `"AI Assistant"` on an automated one, the
 * signed-in agent on every other. See `ActivityEntry`'s own comment for what
 * that means for the `actorId` filter.
 */
function outboundMessageBranch(f: FeedFilters): Prisma.Sql {
  return Prisma.sql`
    SELECT
      'message:' || m.id::text AS "id",
      ${ACTIVITY_ENTITY_TYPE.ticket}::text AS "entityType",
      m."ticketId"::text AS "entityId",
      'reply_sent'::text AS "action",
      m."authorId" AS "actorId",
      m."senderName" AS "actorName",
      NULL::text AS "fromValue",
      NULL::text AS "toValue",
      m."createdAt" AS "createdAt"
    FROM "message" m
    WHERE m.direction = ${MESSAGE_DIRECTION.outbound}::"MessageDirection"
      ${f.actorId ? Prisma.sql`AND m."authorId" = ${f.actorId}` : Prisma.empty}
      ${dateFilter(Prisma.sql`m."createdAt"`, f)}
  `;
}

/** A knowledge-base edit. No `fromValue`/`toValue` — a revision is a full
 *  snapshot, not a transition, so there is nothing to diff here. */
function knowledgeRevisionBranch(f: FeedFilters): Prisma.Sql {
  return Prisma.sql`
    SELECT
      'knowledge_revision:' || kar.id::text AS "id",
      ${ACTIVITY_ENTITY_TYPE.knowledge}::text AS "entityType",
      kar."articleId" AS "entityId",
      kar.action::text AS "action",
      kar."editorId" AS "actorId",
      kar."editorName" AS "actorName",
      NULL::text AS "fromValue",
      NULL::text AS "toValue",
      kar."createdAt" AS "createdAt"
    FROM "knowledge_article_revision" kar
    WHERE TRUE
      ${f.actorId ? Prisma.sql`AND kar."editorId" = ${f.actorId}` : Prisma.empty}
      ${dateFilter(Prisma.sql`kar."createdAt"`, f)}
  `;
}

/** An admin action against a colleague's account. */
function adminActivityBranch(f: FeedFilters): Prisma.Sql {
  return Prisma.sql`
    SELECT
      'admin_activity:' || aa.id::text AS "id",
      ${ACTIVITY_ENTITY_TYPE.admin}::text AS "entityType",
      aa."targetUserId" AS "entityId",
      aa.action::text AS "action",
      aa."actorId" AS "actorId",
      aa."actorName" AS "actorName",
      aa."fromValue" AS "fromValue",
      aa."toValue" AS "toValue",
      aa."createdAt" AS "createdAt"
    FROM "admin_activity" aa
    WHERE TRUE
      ${f.actorId ? Prisma.sql`AND aa."actorId" = ${f.actorId}` : Prisma.empty}
      ${dateFilter(Prisma.sql`aa."createdAt"`, f)}
  `;
}

/**
 * A change to the handoff-target setting. `entityId` is null — there is no
 * per-record id here, only one system-wide setting — and `fromValue`/
 * `toValue` read the named person's name when the side they're on is
 * `user`, or the target itself otherwise, the same phrasing
 * `PipelineHandoff` renders from `AutomationSettings`.
 */
function automationRevisionBranch(f: FeedFilters): Prisma.Sql {
  return Prisma.sql`
    SELECT
      'automation_revision:' || asr.id::text AS "id",
      ${ACTIVITY_ENTITY_TYPE.automation}::text AS "entityType",
      NULL::text AS "entityId",
      'handoff_changed'::text AS "action",
      asr."changedById" AS "actorId",
      asr."changedByName" AS "actorName",
      CASE WHEN asr."fromTarget" = ${HANDOFF_TARGET.user}::"HandoffTarget"
        THEN asr."fromUserName" ELSE asr."fromTarget"::text END AS "fromValue",
      CASE WHEN asr."toTarget" = ${HANDOFF_TARGET.user}::"HandoffTarget"
        THEN asr."toUserName" ELSE asr."toTarget"::text END AS "toValue",
      asr."createdAt" AS "createdAt"
    FROM "automation_settings_revision" asr
    WHERE TRUE
      ${f.actorId ? Prisma.sql`AND asr."changedById" = ${f.actorId}` : Prisma.empty}
      ${dateFilter(Prisma.sql`asr."createdAt"`, f)}
  `;
}

/**
 * Every branch, tagged with the entity type it answers to `entityType=` —
 * `ticket` names two, because both a `TicketActivity` row and a sent reply
 * describe something that happened to a ticket.
 */
const BRANCHES: {
  entityType: ActivityEntityType;
  build: (f: FeedFilters) => Prisma.Sql;
}[] = [
  { entityType: ACTIVITY_ENTITY_TYPE.ticket, build: ticketActivityBranch },
  { entityType: ACTIVITY_ENTITY_TYPE.ticket, build: outboundMessageBranch },
  { entityType: ACTIVITY_ENTITY_TYPE.knowledge, build: knowledgeRevisionBranch },
  { entityType: ACTIVITY_ENTITY_TYPE.admin, build: adminActivityBranch },
  { entityType: ACTIVITY_ENTITY_TYPE.automation, build: automationRevisionBranch },
];

/** Raw-row shape. `$queryRaw<T[]>` is an unchecked cast — every column above
 *  is written out by hand, so a renamed alias here goes `undefined` at
 *  runtime rather than failing to compile. */
interface FeedRow {
  id: string;
  entityType: string;
  entityId: string | null;
  action: string;
  actorId: string | null;
  actorName: string;
  fromValue: string | null;
  toValue: string | null;
  createdAt: Date;
}

/**
 * Every string column above is written by this file alone — never a request
 * body — so the casts to the narrower union types are sound the same way
 * `toActivityEntry`'s sibling shapers elsewhere in this codebase cast a
 * `Prisma`-typed enum column onto its `@ticket/shared` mirror.
 */
export function toActivityEntry(row: FeedRow): ActivityEntry {
  return {
    id: row.id,
    entityType: row.entityType as ActivityEntityType,
    entityId: row.entityId,
    action: row.action as ActivityAction,
    actorId: row.actorId,
    actorName: row.actorName,
    fromValue: row.fromValue,
    toValue: row.toValue,
    createdAt: row.createdAt.toISOString(),
  };
}

export const activityRouter = Router();

activityRouter.get(
  "/",
  requireAdmin,
  async (
    req: Request,
    res: Response<ActivityFeedResponse | { error: string }>,
  ) => {
    const parsed = activityQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const { actorId, entityType, from, to, page, pageSize } = parsed.data;
    const filters: FeedFilters = { actorId, from, to };

    // Naming an entity type skips building the other branches entirely,
    // rather than unioning all five and throwing four away.
    const included = BRANCHES.filter(
      (b) => !entityType || b.entityType === entityType,
    ).map((b) => b.build(filters));

    const feed = Prisma.join(included, " UNION ALL ");

    const pageSql = Prisma.sql`
      SELECT * FROM (${feed}) AS feed
      ORDER BY "createdAt" DESC, "id" DESC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `;
    const countSql = Prisma.sql`
      SELECT COUNT(*)::int AS "total" FROM (${feed}) AS feed
    `;

    // One transaction so the count can't drift from the page beside it —
    // same reasoning as `GET /api/tickets`.
    const [rows, countRows] = await prisma.$transaction([
      prisma.$queryRaw<FeedRow[]>(pageSql),
      prisma.$queryRaw<{ total: number }[]>(countSql),
    ]);

    res.json({
      entries: rows.map(toActivityEntry),
      total: countRows[0]?.total ?? 0,
      page,
      pageSize,
    });
  },
);
