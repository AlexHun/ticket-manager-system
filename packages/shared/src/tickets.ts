import type { AutoReplyDecline } from "./index.ts";
import { TICKET_SEARCH_MAX_LENGTH } from "./ticket-list.ts";
import type { User } from "./users.ts";

/**
 * A ticket's lifecycle, in order:
 *
 *   New ──► Processing ──► Resolved         the knowledge base answered it
 *    │           └───────► Open             it declined; a human's turn
 *    └──────────────────► Open ──► Resolved ──► Closed
 *
 * The key order is the *declaration* order of the Postgres enum, which is how
 * Postgres sorts it and therefore what "sort by status" means in the list. Keep
 * the two in step: reordering here without a matching migration silently changes
 * the order of a column nobody thought they were touching.
 *
 * `New` is where a ticket arrives and where it stays until something moves it.
 * Only the auto-reply pipeline does that automatically, so a deployment with no
 * AI key leaves every ticket here — which is the honest reading of "nobody has
 * triaged this yet", and the reason the dashboard counts New as backlog
 * alongside Open.
 *
 * `Processing` means a worker is composing a reply for this ticket right now.
 * It is the one status the tickets list hides, so that an agent cannot open a
 * ticket the model is about to answer and write a second reply to it. It lasts
 * seconds, and nothing outside the job that set it may put a ticket into it —
 * see `AGENT_SETTABLE_STATUS`.
 */
export const TICKET_STATUS = {
  New: "New",
  Processing: "Processing",
  Open: "Open",
  Resolved: "Resolved",
  Closed: "Closed",
} as const;

export type TicketStatus = (typeof TICKET_STATUS)[keyof typeof TICKET_STATUS];

/**
 * The statuses a client may *filter* by.
 *
 * Everything but `Processing`, because the list refuses to show those rows at
 * all — offering a filter that is guaranteed to return nothing is worse than
 * rejecting it, and rejecting it says why.
 */
export const CLIENT_TICKET_STATUS = [
  TICKET_STATUS.New,
  TICKET_STATUS.Open,
  TICKET_STATUS.Resolved,
  TICKET_STATUS.Closed,
] as const;

export type ClientTicketStatus = (typeof CLIENT_TICKET_STATUS)[number];

/**
 * The statuses a person may *set*.
 *
 * `Processing` is excluded because it is a claim held by a background worker: a
 * person setting it by hand would hide a ticket from everyone else with nothing
 * on its way to un-hide it. `New` is excluded because it is where a ticket
 * begins and there is nothing to be gained from putting one back — an agent who
 * wants to disown a ticket clears the assignee.
 *
 * Enforced server-side by `updateTicketStatusSchema`; the picker in the UI only
 * offers these because the API only accepts these.
 */
export const AGENT_SETTABLE_STATUS = [
  TICKET_STATUS.Open,
  TICKET_STATUS.Resolved,
  TICKET_STATUS.Closed,
] as const;

export type AgentSettableStatus = (typeof AGENT_SETTABLE_STATUS)[number];

/**
 * Statuses that mean "nobody has dealt with this yet".
 *
 * `New` and `Open` both count: before the two were split, every unhandled ticket
 * was Open, and every backlog metric was written as `status = Open`. Leaving
 * them that way would have made a deployment with no AI key report an empty
 * queue while every ticket in it sat unread in `New`.
 */
export const BACKLOG_STATUS = [TICKET_STATUS.New, TICKET_STATUS.Open] as const;

export const TICKET_CATEGORY = {
  General: "General",
  Technical: "Technical",
  Refund: "Refund",
  Other: "Other",
} as const;

export type TicketCategory =
  (typeof TICKET_CATEGORY)[keyof typeof TICKET_CATEGORY];

/**
 * A stored category, narrowed to one this build has a name for.
 *
 * The sibling of `asAutoReplyDecline`, and it exists for the same reason:
 * `EvalCaseResult.expectedCategory` and the `category` inside a stored verdict
 * are plain text and `Json` respectively, so the type on the wire is a promise
 * the API keeps rather than one Postgres keeps for it.
 *
 * `unknown` in rather than `string | null`, unlike its sibling, because one of
 * its two callers reads a value out of a `Json` column — where Postgres
 * promises nothing at all about the shape, not even that it is a string.
 * Anything unrecognised becomes null, which every reader already has to handle:
 * a repeat the classifier could not answer carries the same null.
 */
export function asTicketCategory(value: unknown): TicketCategory | null {
  return Object.values(TICKET_CATEGORY).find((c) => c === value) ?? null;
}

export interface Ticket {
  id: number;
  subject: string;
  status: TicketStatus;
  category: TicketCategory | null;
  customerEmail: string;
  customerName: string;
  assignedToId: string | null;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
}

export const MESSAGE_DIRECTION = {
  inbound: "inbound",
  outbound: "outbound",
} as const;

export type MessageDirection =
  (typeof MESSAGE_DIRECTION)[keyof typeof MESSAGE_DIRECTION];

/**
 * Longest reply an agent can send, mirrored by the zod schema in `@ticket/core`.
 *
 * A sanity bound on one request rather than a style rule: a real answer with a
 * quoted history under it fits comfortably, and a megabyte pasted into the box
 * does not. Lives here so the composer and the server agree on the number
 * without either one restating it.
 */
export const MAX_MESSAGE_BODY_LENGTH = 10_000;

export interface Message {
  id: number;
  ticketId: number;
  messageId: string;
  inReplyTo: string | null;
  senderEmail: string;
  senderName: string;
  textBody: string | null;
  htmlBody: string | null;
  direction: MessageDirection;
  /**
   * The agent who wrote it, for an outbound reply. Null on everything inbound —
   * a customer has no row in the user table — and null again once that agent is
   * deleted, so this is a credit line and never an ownership claim.
   */
  authorId: string | null;
  /**
   * This reply was written by the knowledge-base auto-reply, not by a person.
   *
   * Its own field rather than something inferred from `authorId`, which is null
   * on an automated reply and *also* null on a reply whose author has since been
   * deleted. Those two are not the same thing and an agent reading a thread has
   * to be able to tell them apart, so the fact is recorded rather than guessed.
   */
  automated: boolean;
  /**
   * The knowledge-base articles an automated reply was built from — `["KB-004"]`.
   *
   * Always empty on anything a person wrote and on everything inbound, so an
   * agent reading the thread can tell "a machine sent this, from these articles"
   * from "a colleague sent this". Every id here resolved against the corpus the
   * model was actually given, because a reply whose citations did not resolve
   * was thrown away rather than sent — see check 4 in `ai/auto-reply.ts`.
   *
   * Safe to render. These are ids from our own file, not model output: the
   * strings that reached the database are the ids of articles that were looked
   * up and found, never the raw text the model returned.
   */
  citedArticleIds: string[];
  createdAt: string;
}

/**
 * Ceiling on a ticket id. Postgres `Int` is int4, so an id above this can't
 * exist — rejecting it up front keeps a hand-typed URL from reaching Prisma,
 * which would throw on the conversion and turn a bad request into a 500.
 */
export const MAX_TICKET_ID = 2_147_483_647;

/**
 * The assignee fields the detail view renders. Picked from `User` rather than
 * re-declared, and deliberately without role/emailVerified — a ticket view is
 * not a window onto the user table.
 */
export type TicketAssignee = Pick<User, "id" | "name" | "email">;

/**
 * A thread message as the API serves it.
 *
 * `htmlBody` is absent by design: it is whatever a stranger emailed support, so
 * it never leaves the database. `authorId` is absent for a duller reason —
 * nothing in the thread renders it. `senderName` and `senderEmail` are written
 * from the session at reply time and are what the bubble shows, so the id would
 * be an internal handle travelling for nobody. Keeping both out of the type
 * means a route that tried to send them wouldn't compile.
 */
export type ThreadMessage = Omit<Message, "htmlBody" | "authorId">;

/** A ticket whose assignee has been looked up for us. */
export interface TicketWithAssignee extends Ticket {
  /** Resolved server-side: `assignedToId` alone can't be looked up by an agent. */
  assignedTo: TicketAssignee | null;
}

/** A ticket plus the things only the detail view needs. */
export interface TicketDetail extends TicketWithAssignee {
  /** The whole thread, oldest first. */
  messages: ThreadMessage[];
  /**
   * Why the auto-reply left this one for a person, and when.
   *
   * On `TicketDetail` rather than on `Ticket`, so it does not ride along on
   * every row of a 25-row list that has nowhere to show it. Null on the great
   * majority of tickets: a human-created ticket, one the machine answered, and
   * one it has not reached yet all read the same here — this says only "it
   * looked, and here is what it concluded".
   */
  autoReplyDecline: AutoReplyDecline | null;
  autoReplyDeclinedAt: string | null;
}

export interface TicketDetailResponse {
  ticket: TicketDetail;
}

/**
 * Everyone a ticket can be handed to.
 *
 * Served by the tickets API rather than `/api/users`, which is admin-only:
 * agents assign tickets too, and this is the one slice of the user table they
 * need to do it.
 */
export interface TicketAssigneesResponse {
  assignees: TicketAssignee[];
}

/**
 * A ticket the caller has been assigned but has not yet opened.
 *
 * `assignedTo = viewer AND assignmentSeenAt IS NULL` (ADR-0013) —
 * deliberately not `TICKET_VIEW.mine`, which is status-scoped and answers a
 * different question. Only what a toast or badge needs to name the ticket;
 * everything else is a `GET /api/tickets/:id` away.
 */
export interface UnreadAssignment {
  id: number;
  subject: string;
}

export interface TicketUnreadResponse {
  tickets: UnreadAssignment[];
}

/**
 * The reply to an assignment change. No `messages` — reassigning doesn't touch
 * the thread, and re-sending it would grow with every reply on the ticket.
 */
export interface UpdateTicketResponse {
  ticket: TicketWithAssignee;
}

/**
 * The reply to a posted message. Just the message — the client is already
 * holding the thread and only needs the one entry to add to the end of it, and
 * re-sending the whole thing would grow with every reply on the ticket. Same
 * reasoning as `UpdateTicketResponse` carrying no `messages`.
 *
 * The ticket's `lastMessageAt` moved too, and is deliberately not echoed: it is
 * exactly this message's `createdAt`, because the route writes both from a
 * single instant inside one transaction.
 */
export interface CreateTicketMessageResponse {
  message: ThreadMessage;
}

/**
 * The 404 the ticket and AI routes answer for a ticket that is not there. It
 * reaches the reply box, the field selects and the summary panel as a toast or
 * an alert, so it is copy (`docs/standards/copy.md`), and the E2E spec reads it
 * from here rather than retyping it.
 */
export const TICKET_NOT_FOUND_MESSAGE = "Couldn't find this ticket.";

/**
 * What the ticket schemas in `@ticket/core` answer for a reply, a draft or a
 * search they refuse. Each reaches an alert, so each is copy, and the API,
 * web and E2E suites read them from here rather than retyping them.
 */
export const TICKET_INPUT_MESSAGE = {
  replyEmpty: "Write a reply before sending.",
  replyTooLong: `Keep the reply to ${MAX_MESSAGE_BODY_LENGTH} characters or fewer.`,
  draftEmpty: "Write a draft before polishing.",
  draftTooLong: `Keep the draft to ${MAX_MESSAGE_BODY_LENGTH} characters or fewer.`,
  searchTooLong: `Keep the search to ${TICKET_SEARCH_MAX_LENGTH} characters or fewer.`,
} as const;

/**
 * The ticket list's empty state when no filter or view narrows it — which is
 * the only time it can promise that arriving email will fill it.
 */
export const NO_TICKETS_YET =
  "No tickets yet. They appear here as customer email arrives.";

/**
 * `PATCH /api/tickets/:id/assignee`'s 400 for an id that names nobody who can
 * hold a ticket — someone removed from the Team since the picker loaded.
 */
export const ASSIGNEE_NOT_FOUND_MESSAGE =
  "Couldn't find that assignee. Pick someone else.";

/**
 * What happened to a ticket. The Postgres enum of the same name mirrors this.
 *
 * Seven and not more: each one is a change an agent reading the ticket has to be
 * able to account for. Things that change no field a person reads are absent on
 * purpose — the auto-reply's `Processing` claim (invisible by design, and over in
 * seconds), the `classifiedAt` stamp a dead-lettered job leaves behind, and a
 * reply, which is already the most visible thing in the thread and needs no line
 * beside it saying a reply happened.
 */
export const TICKET_ACTIVITY_ACTION = {
  /** The ticket was opened by an inbound email. Always the first entry. */
  created: "created",
  status_changed: "status_changed",
  category_changed: "category_changed",
  assignee_changed: "assignee_changed",
  /** A customer replied to a ticket the machine had resolved. */
  reopened: "reopened",
  /** The knowledge base answered it and it was filed under the assistant. */
  auto_resolved: "auto_resolved",
  /** The auto-reply handed it back. `toValue` carries the `AutoReplyDecline`. */
  auto_declined: "auto_declined",
} as const;

export type TicketActivityAction =
  (typeof TICKET_ACTIVITY_ACTION)[keyof typeof TICKET_ACTIVITY_ACTION];

/**
 * What kind of thing made the change.
 *
 * Not a `UserRole`. The question a trail has to answer first is whether a person
 * did this at all, and two of these three answers are not people — which is the
 * entire reason the ticket log was worth building while three of the writers are
 * machines.
 */
export const TICKET_ACTOR_KIND = {
  /** A signed-in person, agent or admin. */
  agent: "agent",
  /** The automated user row. `actorId` points at it. */
  assistant: "assistant",
  /** An inbound email did it. No account, so no `actorId` and no `actorEmail`. */
  customer: "customer",
} as const;

export type TicketActorKind =
  (typeof TICKET_ACTOR_KIND)[keyof typeof TICKET_ACTOR_KIND];

/**
 * One recorded change, as the thread renders it.
 *
 * `fromValue`/`toValue` are already display strings — a status, a category, an
 * assignee's *name*, or a decline reason — and never ids. The trail has to stay
 * readable after the account it names is deleted, which is exactly when it gets
 * read; same argument `KnowledgeArticleRevision` makes for `editorName`.
 *
 * No `actorId` on the wire. Nothing in the UI links to a user from here, and the
 * name beside the entry is the denormalised copy rather than a join, so sending
 * the id would only invite somebody to join on it later and undo that.
 */
export interface TicketActivity {
  id: number;
  action: TicketActivityAction;
  fromValue: string | null;
  toValue: string | null;
  actorKind: TicketActorKind;
  actorName: string;
  createdAt: string;
}

export interface TicketActivityResponse {
  activity: TicketActivity[];
}
