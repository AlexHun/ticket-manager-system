import {
  ACTIVITY_ENTITY_TYPE,
  type ActivityAction,
  type ActivityEntityType,
  type ActivityEntry,
} from "@ticket/shared";

/**
 * How one entry in the unified feed (`GET /api/activity`) reads on the
 * `/activity` page.
 *
 * A full `Record` over `ActivityAction` rather than a lookup with a fallback —
 * the same forcing function `ACTIVITY_EVENT_FIELD` and `DECLINE_STAGE` use in
 * `@ticket/shared`: a new action added to any of the five sources this feed
 * merges is a compile error here until somebody decides how it reads, rather
 * than a raw enum key silently reaching the page.
 *
 * `"created"` is shared by `TicketActivity` and `KnowledgeArticleRevision` —
 * the two vocabularies collide on that one string (see the comment on
 * `ACTIVITY_ACTION` in `@ticket/shared`) — so it reads as the generic
 * "Created" here. That is not a loss of information: every row also carries
 * its own entity-type badge, which is what actually says *what* was created.
 */
export const ACTIVITY_ACTION_LABEL: Record<ActivityAction, string> = {
  created: "Created",
  status_changed: "Status changed",
  category_changed: "Category changed",
  assignee_changed: "Assignee changed",
  reopened: "Reopened",
  auto_resolved: "Auto-resolved",
  auto_declined: "Auto-reply declined",
  updated: "Edited",
  archived: "Archived",
  restored: "Restored",
  user_created: "User created",
  user_invited: "User invited",
  user_edited: "User edited",
  role_changed: "Role changed",
  user_deleted: "User deleted",
  reply_sent: "Reply sent",
  handoff_changed: "Handoff changed",
};

export const ACTIVITY_ENTITY_LABEL: Record<ActivityEntityType, string> = {
  [ACTIVITY_ENTITY_TYPE.ticket]: "Ticket",
  [ACTIVITY_ENTITY_TYPE.knowledge]: "Knowledge",
  [ACTIVITY_ENTITY_TYPE.admin]: "Admin",
  [ACTIVITY_ENTITY_TYPE.automation]: "Automation",
};

/**
 * Where a row links to, or `null` when there is nowhere to send it.
 *
 * `ticket`: straight to the detail page. `knowledge`: the knowledge base has
 * no per-article route yet (`KnowledgePage` renders every article on one
 * page), so this links to the list rather than inventing a deep link.
 * `admin`/`automation`: no link — `ActivityEntry`'s own comment on `entityId`
 * says why (no page of its own for the account acted on, and no record with
 * an id for the one system-wide handoff setting).
 */
export function activityEntryHref(entry: ActivityEntry): string | null {
  switch (entry.entityType) {
    case ACTIVITY_ENTITY_TYPE.ticket:
      return entry.entityId ? `/tickets/${entry.entityId}` : null;
    case ACTIVITY_ENTITY_TYPE.knowledge:
      return "/knowledge";
    case ACTIVITY_ENTITY_TYPE.admin:
    case ACTIVITY_ENTITY_TYPE.automation:
      return null;
  }
}

/** The text a row's entity link shows, when it has one. */
export function activityEntryLinkLabel(entry: ActivityEntry): string {
  switch (entry.entityType) {
    case ACTIVITY_ENTITY_TYPE.ticket:
      return `#${entry.entityId}`;
    case ACTIVITY_ENTITY_TYPE.knowledge:
      // `entityId` is the article id (`KB-004`) — the same string the article
      // itself is titled with everywhere else in the app.
      return entry.entityId ?? "Knowledge base";
    case ACTIVITY_ENTITY_TYPE.admin:
    case ACTIVITY_ENTITY_TYPE.automation:
      return "";
  }
}
