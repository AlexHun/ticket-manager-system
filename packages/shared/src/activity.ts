import { KNOWLEDGE_REVISION_ACTION } from "./knowledge.ts";
import { TICKET_ACTIVITY_ACTION } from "./tickets.ts";
import { ADMIN_ACTIVITY_ACTION } from "./users.ts";

/**
 * The unified admin activity feed (`GET /api/activity`) is a query-time merge
 * of five sources that each already have their own trail — `TicketActivity`,
 * `KnowledgeArticleRevision`, `AdminActivity`, `AutomationSettingsRevision` —
 * plus outbound replies, derived from `Message` (`direction: outbound`)
 * because a sent reply isn't its own activity row anywhere today. Never a
 * sixth table: this repo already answers "new table vs deriving from
 * existing ones" for tickets and knowledge with dedicated per-domain trails
 * rather than one shared table, and the feed is that same answer applied to
 * *reading* across all of them at once, in `routes/activity.ts`.
 *
 * Four entity types, not five sources: an outbound reply is filed under
 * `ticket`, the same entity type as a `TicketActivity` row, because both
 * describe something that happened *to a ticket* and the filter is asking
 * "which desk", not "which table".
 */
export const ACTIVITY_ENTITY_TYPE = {
  ticket: "ticket",
  knowledge: "knowledge",
  admin: "admin",
  automation: "automation",
} as const;

export type ActivityEntityType =
  (typeof ACTIVITY_ENTITY_TYPE)[keyof typeof ACTIVITY_ENTITY_TYPE];

/** Render/validate order for the entity-type filter. */
export const ACTIVITY_ENTITY_TYPES = [
  ACTIVITY_ENTITY_TYPE.ticket,
  ACTIVITY_ENTITY_TYPE.knowledge,
  ACTIVITY_ENTITY_TYPE.admin,
  ACTIVITY_ENTITY_TYPE.automation,
] as const;

/**
 * What happened, across every source the feed merges. Each existing action
 * vocabulary is spread in unchanged — `TICKET_ACTIVITY_ACTION`,
 * `KNOWLEDGE_REVISION_ACTION` and `ADMIN_ACTIVITY_ACTION` — so a ticket's
 * `status_changed` still means only what `TicketActivity` already says it
 * means, plus two synthetic actions for the two sources this feed reads that
 * had no action column of their own: `reply_sent` for an outbound `Message`
 * (there was never a "what kind of message" column, only a direction) and
 * `handoff_changed` for `AutomationSettingsRevision` (one field pair, so a
 * change is the only thing that can happen there — the same reasoning that
 * model's own schema comment gives for having no `action` column at all).
 */
export const ACTIVITY_ACTION = {
  ...TICKET_ACTIVITY_ACTION,
  ...KNOWLEDGE_REVISION_ACTION,
  ...ADMIN_ACTIVITY_ACTION,
  reply_sent: "reply_sent",
  handoff_changed: "handoff_changed",
} as const;

export type ActivityAction =
  (typeof ACTIVITY_ACTION)[keyof typeof ACTIVITY_ACTION];

/**
 * One entry in the merged feed, normalised to a single wire shape.
 *
 * `fromValue`/`toValue` are already display strings, the same convention
 * `TicketActivity` and `AdminActivity` use — never ids, and readable after
 * the account or article they name is gone. Both are null on a
 * `KnowledgeArticleRevision` row (a full snapshot, not a transition — see
 * that model's own comment) and on `reply_sent` (nothing to diff; the reply
 * itself is the content).
 *
 * `entityId` is what a future frontend links to: a ticket id for `ticket`, an
 * article id (`KB-004`) for `knowledge`. Null for `admin` (the account acted
 * on has no page of its own) and for `automation` (a change to one
 * system-wide setting, not a record with an id).
 *
 * One filtering surprise worth naming here rather than only in the route: an
 * automated reply's `Message.authorId` is null by design (see `domain.md`'s
 * note on the assistant never being a message's *author*), so filtering this
 * feed by the assistant's own user id will not surface its replies — only its
 * `TicketActivity` rows (`auto_resolved`, `auto_declined`), where `actorId`
 * is deliberately set. That is the existing schema's own distinction between
 * "who dealt with this" and "who wrote this", not a gap the feed introduces.
 */
export interface ActivityEntry {
  /** Unique across every source: `"<table>:<row id>"`. A React key, never a
   *  value that round-trips back into a filter. */
  id: string;
  entityType: ActivityEntityType;
  entityId: string | null;
  action: ActivityAction;
  actorId: string | null;
  actorName: string;
  fromValue: string | null;
  toValue: string | null;
  createdAt: string;
}

export interface ActivityFeedResponse {
  /** One page of entries, newest first. */
  entries: ActivityEntry[];
  /** Entries matching the current filters, ignoring pagination. */
  total: number;
  /** Echoed back because the server clamps both. 1-based. */
  page: number;
  pageSize: number;
}
