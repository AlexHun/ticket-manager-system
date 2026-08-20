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
export const BACKLOG_STATUS = [
  TICKET_STATUS.New,
  TICKET_STATUS.Open,
] as const;

export const TICKET_CATEGORY = {
  General: "General",
  Technical: "Technical",
  Refund: "Refund",
  Other: "Other",
} as const;

export type TicketCategory =
  (typeof TICKET_CATEGORY)[keyof typeof TICKET_CATEGORY];

export const USER_ROLE = {
  admin: "admin",
  agent: "agent",
} as const;

export type UserRole = (typeof USER_ROLE)[keyof typeof USER_ROLE];

/**
 * Why the knowledge-base auto-reply left a ticket for a person.
 *
 * Declining is the designed, common outcome — most support mail is not a
 * knowledge-base question, and six checks fail closed on the rest. Until this
 * existed none of that reached anyone: a declined ticket and a ticket the
 * machine never looked at were the same `Open` row, so an agent could not learn
 * the system's edges and an admin could not tell a working knowledge base from
 * a broken one. The reason was written to a log line and nowhere else.
 *
 * Deliberately finer than `AutoReplyFailure` in the API, which drives *retries*
 * and must stay coarse — four different checks all mean "do not try again" to
 * pg-boss and four different things to a person reading the ticket. The two
 * travel together and neither replaces the other.
 *
 * The ordering below is the order they occur in: three gates before the model is
 * called, then its own verdict, then the checks over what it wrote.
 */
export const AUTO_REPLY_DECLINE = {
  /** Refund, or still unclassified. A machine may not answer either. */
  category: "category",
  /** Somebody had already replied — the corpus answers openings, not threads. */
  answered: "answered",
  /** The opening email had no plain text to read. */
  noText: "noText",
  /** It read the corpus and said this is not covered. The common one. */
  notCovered: "notCovered",
  /** It answered, but cited nothing that resolves against the corpus. */
  noCitation: "noCitation",
  /** The reply promised money its cited articles do not mention. */
  unbackedCommitment: "unbackedCommitment",
  /** The reply carried a link or address its cited articles do not contain. */
  unbackedReference: "unbackedReference",
  /** Longer than a knowledge-base answer has any business being. */
  tooLong: "tooLong",
  /** The provider failed, or the retry ladder ran out. Not a judgement. */
  unavailable: "unavailable",
} as const;

export type AutoReplyDecline =
  (typeof AUTO_REPLY_DECLINE)[keyof typeof AUTO_REPLY_DECLINE];

/**
 * A stored decline reason, narrowed to one the client has wording for.
 *
 * `Ticket.autoReplyDecline` is a plain `text` column (see the note on the model
 * for why), so the type on the wire is a promise the API has to keep rather than
 * one Postgres keeps for it. Anything unrecognised becomes null: a reason the UI
 * cannot name is not better than silence, and the alternative is rendering a raw
 * database string at an agent.
 *
 * Here rather than in a route because two routes now need it — the ticket detail
 * and the pipeline — and a narrowing that exists twice is a narrowing that will
 * eventually disagree with itself.
 */
export function asAutoReplyDecline(value: string | null): AutoReplyDecline | null {
  if (value === null) return null;
  return (
    Object.values(AUTO_REPLY_DECLINE).find((d) => d === value) ?? null
  );
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

/**
 * Columns the tickets list can be sorted by. Doubles as the table's column ids
 * on the client and as the key into the API's orderBy map, so the two stay
 * in step by construction.
 */
export const TICKET_SORT_FIELD = {
  subject: "subject",
  customerName: "customerName",
  status: "status",
  category: "category",
  /** Sorts by the assignee's *name*, not the id — the id is a cuid and orders by nothing a reader can see. */
  assignedTo: "assignedTo",
  /**
   * When anything last happened on the thread, in either direction.
   *
   * This is the column a support queue is actually about: `createdAt` says when
   * a ticket arrived and never changes again, so a customer who replies to a
   * three-week-old ticket stays three weeks down the list under it. Ascending
   * is "longest silence first", which is the order the dashboard's
   * needs-attention panel already uses.
   */
  lastMessageAt: "lastMessageAt",
  createdAt: "createdAt",
} as const;

export type TicketSortField =
  (typeof TICKET_SORT_FIELD)[keyof typeof TICKET_SORT_FIELD];

export const SORT_ORDER = {
  asc: "asc",
  desc: "desc",
} as const;

export type SortOrder = (typeof SORT_ORDER)[keyof typeof SORT_ORDER];

/**
 * What the API sorts by when the request carries no sort params.
 *
 * Most recent activity first, not most recently created. The two agree on a
 * quiet queue and diverge exactly when it matters: a customer replying to an
 * old ticket moves it to the top here, where sorting by `createdAt` left it
 * buried under three weeks of newer arrivals and no column on the page showed
 * that anything had happened.
 *
 * Descending rather than ascending, deliberately. "Longest silence first" is
 * the more pointed question, but it is only meaningful for tickets still in
 * play — as a *default*, over a list that includes Resolved and Closed, it
 * would head the page with the deadest threads in the database. It is one
 * click away instead: sort by the same column ascending, with a status filter.
 */
export const DEFAULT_TICKET_SORT = {
  field: TICKET_SORT_FIELD.lastMessageAt,
  order: SORT_ORDER.desc,
} as const;

/**
 * Query-param sentinel for "this ticket has no category". A null can't travel
 * in a query string, and an absent `category` already means "any category".
 */
export const CATEGORY_NONE = "none";

export type TicketCategoryFilter = TicketCategory | typeof CATEGORY_NONE;

/**
 * Query-param sentinel for "nobody is assigned to this ticket" — the same
 * problem CATEGORY_NONE solves, for the assignee filter: a null can't travel in
 * a query string, and an absent `assignedTo` already means "any assignee".
 *
 * Its own constant rather than a shared one, because the two filters are free to
 * diverge; the values only happen to match today. It can't be mistaken for a
 * real assignee either — ids are Better Auth cuids, 32 characters long.
 */
export const ASSIGNEE_NONE = "none";

/**
 * Query-param sentinel for the whole backlog at once — `New` and `Open`
 * together, which is what `BACKLOG_STATUS` means everywhere else here.
 *
 * It exists because the status filter takes one value and "nobody has dealt with
 * this" is two. Every dashboard number carrying that meaning spans both, so
 * until this existed there was no way to click one of those numbers and land on
 * the set it had counted: `status=Open` silently dropped every untriaged ticket,
 * and omitting the filter swept in everything already resolved and closed. Both
 * shipped at different times and both were wrong in a way you could not see from
 * the page you landed on, because a plausible list of tickets looks the same
 * either way.
 *
 * Never stored and not a `TicketStatus` — it names a set, and it is resolved to
 * `BACKLOG_STATUS` at the single place that builds the query. It cannot be
 * mistaken for a real status either: those are capitalised.
 */
export const STATUS_BACKLOG = "backlog";

/** What the status filter accepts: one status, or the backlog as a set. */
export type ClientTicketStatusFilter =
  | ClientTicketStatus
  | typeof STATUS_BACKLOG;

/**
 * The saved views in the sidebar: the four questions an agent opens the queue to
 * ask, each one a ticket-list filter that already existed.
 *
 * Every view is backlog-scoped, and that is the point of the sentinel above. An
 * "Unassigned" that counted resolved and closed tickets would be answering a
 * question nobody asked — on the dev data it is 62 tickets against the 25 that
 * are actually waiting for an owner.
 */
export const TICKET_VIEW = {
  backlog: "backlog",
  unassigned: "unassigned",
  mine: "mine",
  untriaged: "untriaged",
} as const;

export type TicketView = (typeof TICKET_VIEW)[keyof typeof TICKET_VIEW];

/** Render order, narrowest last: the whole queue, then three cuts of it. */
export const TICKET_VIEWS = [
  TICKET_VIEW.backlog,
  TICKET_VIEW.unassigned,
  TICKET_VIEW.mine,
  TICKET_VIEW.untriaged,
] as const;

/**
 * The ticket-list query a view stands for, as the params it travels in.
 *
 * One definition for both ends, and that is the whole design: the sidebar builds
 * its `href` from this, and the API counts each view by feeding the same object
 * through `ticketsQuerySchema` into the same `buildWhere` the list uses. A count
 * and the page it links to therefore cannot disagree without the params object
 * itself being wrong — which is a single table to read rather than two
 * implementations to compare.
 *
 * That is not hypothetical tidiness. Both shipped mismatches this replaces were
 * the same bug: a number computed one way and a link written another.
 *
 * `viewerId` is only consulted by `mine`, and the server passes the *session's*
 * id rather than anything from the request, so the view cannot be pointed at a
 * colleague.
 */
export function ticketViewParams(
  view: TicketView,
  viewerId: string,
): Record<string, string> {
  switch (view) {
    case TICKET_VIEW.backlog:
      return { status: STATUS_BACKLOG };
    case TICKET_VIEW.unassigned:
      return { status: STATUS_BACKLOG, assignedTo: ASSIGNEE_NONE };
    case TICKET_VIEW.mine:
      return { status: STATUS_BACKLOG, assignedTo: viewerId };
    case TICKET_VIEW.untriaged:
      return { status: STATUS_BACKLOG, category: CATEGORY_NONE };
  }
}

/** Longest accepted free-text search, mirrored by the zod schema. */
export const TICKET_SEARCH_MAX_LENGTH = 100;

/** Page sizes offered in the UI. The API accepts any size up to MAX_PAGE_SIZE. */
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

export const DEFAULT_PAGE_SIZE = 25;

/** Ceiling on `pageSize`, so one request can't ask for the whole table. */
export const MAX_PAGE_SIZE = 100;

/** Pages are 1-based on the wire; TanStack's 0-based index is mapped client-side. */
export const FIRST_PAGE = 1;

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

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  emailVerified: boolean;
  /**
   * This row stands for the assistant, not for a person.
   *
   * There is at most one — a partial unique index in the database says so — and
   * it exists to be an *assignee*: a ticket the knowledge base answered by
   * itself carries its name, so "who dealt with this?" has the same kind of
   * answer whether a colleague or a machine dealt with it.
   *
   * Not a third `UserRole`. A role decides what an account may *do*, and this
   * account does nothing: it has no credential row, so nothing can sign in as
   * it, and every mutating route refuses it. Widening the role union would have
   * put a machine in every place the codebase asks "admin or agent?" — including
   * Better Auth's own config and the route guards — to describe something that
   * is not a permission level.
   *
   * Deliberately not the author of the replies it is assigned to. Those keep
   * `authorId: null` and `automated: true`, because "nobody wrote this" is what
   * an agent reading the thread needs told, and it is not the same fact as "this
   * ticket is filed under the assistant".
   */
  automated: boolean;
  createdAt: string;
}

/**
 * Who picks up a ticket the assistant could not finish.
 *
 * The auto-reply hands a ticket back on every path but one — most support mail
 * is not a knowledge-base question, six checks fail closed on the rest, and the
 * provider can simply be down. Until this existed, all of that landed in `Open`
 * with no owner, which is the same place a ticket sits when nobody has looked at
 * it yet. The point of the setting is that the two stop looking alike.
 *
 * Three targets rather than a nullable user id, because "nobody" and "we have
 * not chosen" are different answers and only one of them is a decision.
 */
export const HANDOFF_TARGET = {
  /**
   * The longest-serving admin, resolved at the moment a ticket is handed back
   * rather than stored. The default, and the only target that keeps working
   * through a change of staff — a stored id would name a person who may have
   * left, and there is nobody to notice until tickets start piling up under a
   * deleted account.
   */
  admin: "admin",
  /** The specific person named in `userId`. */
  user: "user",
  /** Nobody. The ticket goes back to the queue unowned, as it did before. */
  unassigned: "unassigned",
} as const;

export type HandoffTarget =
  (typeof HANDOFF_TARGET)[keyof typeof HANDOFF_TARGET];

/** Render order for the picker: the default, then a person, then nobody. */
export const HANDOFF_TARGETS = [
  HANDOFF_TARGET.admin,
  HANDOFF_TARGET.user,
  HANDOFF_TARGET.unassigned,
] as const;

/**
 * The automation settings as the API serves them.
 *
 * `user` is resolved server-side for the same reason a ticket's assignee is: an
 * id alone is a cuid, and the screen that shows this has to name somebody.
 *
 * `resolvedTo` is the answer to the question the admin is actually asking —
 * *who would get the next handed-back ticket* — computed the same way the job
 * computes it. Without it the `admin` target is a promise the page cannot show
 * the consequence of, and a target of `user` naming somebody since deleted would
 * read as settled when it has silently fallen back.
 */
export interface AutomationSettings {
  target: HandoffTarget;
  user: TicketAssignee | null;
  resolvedTo: TicketAssignee | null;
  /** The assistant's own account, if it has been seeded. */
  assistant: TicketAssignee | null;
  updatedAt: string | null;
  /** Denormalised, so the trail survives the account being deleted. */
  updatedByName: string | null;
}

export interface AutomationSettingsResponse {
  settings: AutomationSettings;
}

export interface TicketsListResponse {
  /**
   * One page of tickets, already sorted and filtered by the server.
   *
   * Assignees are resolved server-side because the list renders them: an
   * `assignedToId` alone is a cuid, and an agent has no route to turn it into a
   * name — `/api/tickets/assignees` only lists who is still assignable.
   */
  tickets: TicketWithAssignee[];
  /** Tickets matching the current filters, ignoring pagination. */
  total: number;
  /** Echoed back because the server clamps both. 1-based. */
  page: number;
  pageSize: number;
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
 * How many tickets each saved view holds.
 *
 * A `Record` over every view rather than a list of whatever was non-zero: the
 * sidebar draws a fixed set of rows, and a missing key would be indistinguishable
 * from a count of nought while quietly shifting the layout. Adding a view is a
 * compile error here until it is counted.
 */
export interface TicketViewCountsResponse {
  counts: Record<TicketView, number>;
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

/**
 * What a screen just stopped being right about.
 *
 * Deliberately **not** `TicketActivityAction`, though they sit next to each other
 * so the difference is read once. The trail above answers "what does an agent
 * reading this ticket have to account for?" — durable, human-readable, mirrored
 * by a Postgres enum. This answers "what does a mounted query have to re-read?" —
 * ephemeral, machine-read, gone the moment it is applied.
 *
 * The comment on `TICKET_ACTIVITY_ACTION` is the proof they cannot be one union:
 * it lists what it excludes on purpose, and one of those is **a reply** ("already
 * the most visible thing in the thread"), which is the single most valuable thing
 * to push. Reusing it would guarantee the channel is silent for exactly the event
 * agents most want to hear. It would also make every new event a Postgres enum
 * migration, for a fact nothing stores.
 *
 * Same shape of argument as `TICKET_ACTOR_KIND` not being a `UserRole`.
 */
export const TICKET_EVENT = {
  /** An inbound email opened a ticket. */
  ticket_created: "ticket_created",
  /** Status, category or assignee moved. `fields` says which. */
  ticket_updated: "ticket_updated",
  /** A message was appended, either direction. */
  ticket_message: "ticket_message",
  /**
   * The unattended pipeline moved: a claim, a release, a verdict, a queue depth.
   *
   * Admin-only, and that is what earns this a fourth kind rather than folding it
   * into `ticket_updated`. The `Processing` claim is invisible by design and over
   * in seconds — pushing it to agents would make every list refetch twice per
   * auto-replied ticket to render no change. `/pipeline` is the one screen that
   * genuinely wants to watch it.
   */
  pipeline_changed: "pipeline_changed",
} as const;

export type TicketEventKind =
  (typeof TICKET_EVENT)[keyof typeof TICKET_EVENT];

/** The three mutable fields, as `ticketChanges` already names them. */
export const TICKET_EVENT_FIELD = {
  status: "status",
  category: "category",
  assignee: "assignee",
} as const;

export type TicketEventField =
  (typeof TICKET_EVENT_FIELD)[keyof typeof TICKET_EVENT_FIELD];

/**
 * Which field each recorded change moved, for the push channel's `fields`.
 *
 * The two vocabularies stay separate — see the note on `TICKET_EVENT` — but the
 * places that write a trail entry and the places that publish an event are the
 * same places, and both already know what moved. This is the one translation
 * between them, so `updateTicket` can hand the array `ticketChanges` returned
 * straight to the publisher instead of diffing the ticket a second time. Two
 * implementations of "what changed" would disagree on exactly the day it
 * mattered.
 *
 * A full `Record` rather than a lookup with a fallback: `null` is a stated
 * answer ("this action moves no field a list is sorted or filtered by"), and an
 * eighth activity action cannot be added without someone deciding which it is.
 */
export const ACTIVITY_EVENT_FIELD: Record<
  TicketActivityAction,
  TicketEventField | null
> = {
  /** The ticket did not change; it began. `ticket_created` carries that. */
  created: null,
  status_changed: TICKET_EVENT_FIELD.status,
  category_changed: TICKET_EVENT_FIELD.category,
  assignee_changed: TICKET_EVENT_FIELD.assignee,
  /** A reopen is a status change wearing a more specific name. */
  reopened: TICKET_EVENT_FIELD.status,
  auto_resolved: TICKET_EVENT_FIELD.status,
  auto_declined: TICKET_EVENT_FIELD.status,
};

/**
 * One event, as it goes down the wire.
 *
 * **An id and a verb, never a payload.** The client is told what to re-read and
 * then re-reads it through the same authenticated `GET` it would have used
 * anyway, so authorization stays in the routes and there is exactly one place it
 * can be got wrong. A payload here would be a second read path with no guard
 * watching it: `GET /api/tickets` refuses to return a `Processing` ticket — "the
 * concurrency control, not cosmetics" — and an event carrying the ticket would
 * push onto an agent's screen precisely the state the list exists to withhold.
 *
 * Today every agent may read every ticket, so a payload would happen to be safe.
 * That is the condition that stops holding the day visibility is scoped per team,
 * quietly and everywhere at once. Same reasoning as `htmlBody` being absent from
 * `ThreadMessage` rather than filtered out of it: the wire type is the
 * enforcement.
 *
 * It is also the reason this stays small. A future `LISTEN/NOTIFY` fan-out caps
 * payloads at 8000 bytes, and a design that only ever sends ids can never meet
 * that wall.
 */
export interface TicketEvent {
  kind: TicketEventKind;
  ticketId: number;
  /** ISO. Ordering, and a "last updated" affordance on screen. */
  at: string;
  /** Only on `ticket_updated`, so the client knows whether counts can have moved. */
  fields?: TicketEventField[];
}

/**
 * Who may hear each kind.
 *
 * A `Record` over the union rather than a check at the publish site, for the same
 * reason `DECLINE_STAGE` is one: a tenth event kind is a compile error until
 * somebody says who is allowed to receive it. Getting that wrong is a disclosure
 * bug, and this is the only place it can be decided.
 *
 * `pipeline_changed` is `admin` because every route in `routes/pipeline.ts` is
 * `requireAdmin` — an event that outran its own endpoint would be a leak that no
 * route guard could catch.
 */
export const EVENT_AUDIENCE: Record<TicketEventKind, UserRole | "all"> = {
  ticket_created: "all",
  ticket_updated: "all",
  ticket_message: "all",
  pipeline_changed: USER_ROLE.admin,
};

/**
 * The reply to POST /api/ai/polish-reply.
 *
 * Plain text, never markup. The composer puts it straight into a textarea and
 * the thread renders `textBody` as a React text node, so anything HTML-shaped
 * would be shown literally at best — see the "never render email HTML" rule.
 *
 * Nothing is persisted by that endpoint, which is why there is no message here
 * and no id: the rewrite exists only in the agent's draft box until they send it.
 */
export interface PolishReplyResponse {
  polished: string;
}

/**
 * How the customer is coming across, as the summary reads them.
 *
 * Four levels rather than the usual positive/neutral/negative three, because the
 * axis a support desk actually triages on is heat, and "negative" flattens the
 * two ends of it that need different handling: a frustrated customer wants their
 * answer, an angry one is deciding whether to escalate. `neutral` is the honest
 * answer for a matter-of-fact report and is what a thread with nothing to read
 * gets — this is never left blank.
 */
export const SUMMARY_SENTIMENT = {
  positive: "positive",
  neutral: "neutral",
  frustrated: "frustrated",
  angry: "angry",
} as const;

export type SummarySentiment =
  (typeof SUMMARY_SENTIMENT)[keyof typeof SUMMARY_SENTIMENT];

/**
 * What the model is asked to produce about one ticket.
 *
 * Structured rather than a paragraph, because the panel renders each part
 * differently and an agent reads them at different moments: the overview answers
 * "what is this", the points answer "what has happened", the next step answers
 * "what do I do", and the sentiment is the thing they see before any of it. A
 * single blob would have to be re-parsed to lay out that way, and the model
 * would decide the shape afresh on every regeneration.
 *
 * Plain text throughout, never markup — same rule as `PolishReplyResponse`, and
 * for the same reason: this is rendered as React text nodes.
 */
export interface TicketSummary {
  /** One or two sentences: what the ticket is about and where it currently stands. */
  overview: string;
  /**
   * What happened in the thread, oldest development first. Empty on a ticket
   * whose thread says nothing beyond its overview — a bulleted restatement of
   * the sentence above it is noise, so the model is allowed to return none.
   */
  keyPoints: string[];
  /**
   * The one thing the agent should do next, or null when the thread has nothing
   * outstanding. Nullable rather than a "nothing to do" string so the panel can
   * leave the section out instead of printing a shrug.
   */
  nextStep: string | null;
  sentiment: SummarySentiment;
  /**
   * The words in the three fields above that must not be skimmed past: order and
   * ticket references, amounts, dates, error text, and whatever names the thing
   * that is blocked. The panel marks each occurrence.
   *
   * Substrings, not concepts — every entry is guaranteed to occur verbatim
   * (case-insensitively) somewhere in `overview`, `keyPoints` or `nextStep`,
   * because the server drops any that does not. A client can therefore match
   * them literally and expect a hit, and an empty list is a normal answer for a
   * summary with nothing worth singling out.
   */
  highlights: string[];
}

/**
 * The reply to POST /api/ai/summarize-ticket.
 *
 * Nothing is persisted, so there is no id and no `generatedAt`: the summary
 * exists in the panel that asked for it until the agent asks again, which is the
 * whole contract — every click is a fresh generation.
 *
 * `messageCount` is how long the thread was when the summary was made, and it is
 * the reason this is not just a `TicketSummary`. The client holds the thread
 * too, so comparing the two is what lets the panel notice that a reply has
 * landed since and say so, rather than showing a confident summary of a
 * conversation that has moved on.
 *
 * Deliberately the whole thread's length rather than the number of messages that
 * reached the model — an HTML-only email carries no `textBody` and is skipped by
 * the prompt, but it is still a message the agent can see in the thread, and a
 * count that disagreed with the one on screen would make the staleness check
 * fire at nothing.
 */
export interface SummarizeTicketResponse {
  summary: TicketSummary;
  messageCount: number;
}

export interface UsersListResponse {
  users: User[];
}

export interface CreateUserResponse {
  user: User;
}

export interface UpdateUserResponse {
  user: User;
}

export interface HealthResponse {
  status: "ok";
}

/**
 * What happened to a knowledge-base article, for the audit trail.
 *
 * Four actions rather than a create/update pair, because archiving is the thing
 * this system does *instead* of deleting and it is the single most consequential
 * edit on the screen — an archived article leaves every future prompt. Reading a
 * revision list, "archived" and "restored" are the entries you are looking for.
 */
export const KNOWLEDGE_REVISION_ACTION = {
  created: "created",
  updated: "updated",
  archived: "archived",
  restored: "restored",
} as const;

export type KnowledgeRevisionAction =
  (typeof KNOWLEDGE_REVISION_ACTION)[keyof typeof KNOWLEDGE_REVISION_ACTION];

/**
 * A knowledge-base article, as the admin screen sees it.
 *
 * **This type carries `internalNote` and the corpus type in the API does not.**
 * That is the whole shape of the feature: `KbArticle` in
 * `apps/api/src/ai/knowledge-base.ts` is what a model is given and has no such
 * field, so the note cannot reach a prompt even by accident. Here it is the
 * point — the guidance about what not to promise and when to escalate is written
 * for the people on this screen.
 *
 * Which also means this type must never be served to anyone but an admin.
 */
export interface KnowledgeArticle {
  /** `KB-001`. Stable, never reused: replies already sent cite it. */
  id: string;
  title: string;
  category: TicketCategory;
  /** The customer-safe answer — the only part a model is ever shown. */
  body: string;
  /** Guidance for staff. Never sent to a model, never quoted to a customer. */
  internalNote: string | null;
  /** Whether the unattended auto-reply may answer from this article. */
  autoReply: boolean;
  /** Retired: out of every prompt, still resolvable by the replies that cite it. */
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * One recorded change, as the trail renders it.
 *
 * `editorName` and `editorEmail` are the denormalised copies stored on the
 * revision, not a join to a live user — the trail has to stay readable after
 * someone's account is deleted, which is exactly when it tends to be read.
 * `editorEmail` is null for the one-time import from `knowledge-base.md`, which
 * had no account behind it.
 */
export interface KnowledgeArticleRevision {
  id: number;
  articleId: string;
  action: KnowledgeRevisionAction;
  title: string;
  category: TicketCategory;
  body: string;
  internalNote: string | null;
  autoReply: boolean;
  archived: boolean;
  editorName: string;
  editorEmail: string | null;
  createdAt: string;
}

export interface KnowledgeArticlesResponse {
  articles: KnowledgeArticle[];
}

export interface KnowledgeArticleResponse {
  article: KnowledgeArticle;
}

export interface KnowledgeArticleRevisionsResponse {
  revisions: KnowledgeArticleRevision[];
}

/** Ceilings on what an admin may write into a prompt. See `knowledgeArticleSchema`. */
export const KB_TITLE_MAX_LENGTH = 200;
export const KB_BODY_MAX_LENGTH = 4_000;
export const KB_INTERNAL_NOTE_MAX_LENGTH = 2_000;

/**
 * Who the dashboard is about.
 *
 * `mine` narrows every panel to the caller's own assigned tickets. The id comes
 * from the session, never from the request, so this is a view control and not
 * an authorisation one — there is deliberately no `userId` param to point it at
 * a colleague.
 */
export const DASHBOARD_SCOPE = {
  mine: "mine",
  all: "all",
} as const;

export type DashboardScope =
  (typeof DASHBOARD_SCOPE)[keyof typeof DASHBOARD_SCOPE];

/**
 * The slice of time every panel is computed over, measured on `createdAt`.
 *
 * Presets only. A custom range needs a date-range picker the UI isn't set up
 * for, and these four already answer "this week / this month / this quarter /
 * this year". No "all time": the volume series would grow without bound.
 */
export const DASHBOARD_RANGE = {
  d7: "7d",
  d30: "30d",
  d90: "90d",
  m12: "12m",
} as const;

export type DashboardRange =
  (typeof DASHBOARD_RANGE)[keyof typeof DASHBOARD_RANGE];

export const DEFAULT_DASHBOARD_RANGE: DashboardRange = DASHBOARD_RANGE.d90;

/** How far back each preset reaches, so the SQL and the axis label agree. */
export const DASHBOARD_RANGE_DAYS: Record<DashboardRange, number> = {
  [DASHBOARD_RANGE.d7]: 7,
  [DASHBOARD_RANGE.d30]: 30,
  [DASHBOARD_RANGE.d90]: 90,
  [DASHBOARD_RANGE.m12]: 365,
};

/** Bucket width for the volume series. `date_trunc` takes exactly these names. */
export const DASHBOARD_BUCKET = {
  day: "day",
  week: "week",
  month: "month",
} as const;

export type DashboardBucket =
  (typeof DASHBOARD_BUCKET)[keyof typeof DASHBOARD_BUCKET];

/**
 * Bucket width per range, so no chart ever draws 365 columns or 2. Server-owned:
 * the client only reads the echoed `bucket` to format the axis.
 */
export const DASHBOARD_RANGE_BUCKET: Record<DashboardRange, DashboardBucket> = {
  [DASHBOARD_RANGE.d7]: DASHBOARD_BUCKET.day,
  [DASHBOARD_RANGE.d30]: DASHBOARD_BUCKET.day,
  [DASHBOARD_RANGE.d90]: DASHBOARD_BUCKET.week,
  [DASHBOARD_RANGE.m12]: DASHBOARD_BUCKET.month,
};

/**
 * Hours-to-first-reply bins. These are ordered, which is why they take the
 * single-hue ordinal ramp rather than four separate colours — and why the key
 * order here *is* the render order. Reordering them without reordering the ramp
 * would make the chart say something false about progression.
 */
export const LATENCY_BUCKET = {
  under1h: "under1h",
  h1to4: "h1to4",
  h4to24: "h4to24",
  over24h: "over24h",
} as const;

export type LatencyBucket =
  (typeof LATENCY_BUCKET)[keyof typeof LATENCY_BUCKET];

/** Age-of-open-ticket bins. Same ordering contract as LATENCY_BUCKET. */
export const AGE_BUCKET = {
  under1d: "under1d",
  d1to3: "d1to3",
  d3to7: "d3to7",
  over7d: "over7d",
} as const;

export type AgeBucket = (typeof AGE_BUCKET)[keyof typeof AGE_BUCKET];

/** Row caps. Named here because the panel headings quote them. */
export const NEEDS_ATTENTION_LIMIT = 6;
export const TOP_CUSTOMERS_LIMIT = 8;
export const WORKLOAD_AGENT_LIMIT = 10;

/** A count per status. Keyed by the status values, so a Record and not a shape. */
export type StatusCounts = Record<TicketStatus, number>;

export interface TicketStatsSummary {
  /** Tickets created inside the slice. */
  total: number;
  /** The same count over the window immediately before it — the delta's baseline. */
  previousTotal: number;
  byStatus: StatusCounts;
  /** Open *and* nobody's: the triage queue, the one number with an action attached. */
  openUnassigned: number;
  /**
   * Resolved+Closed as a share of `total`, 0–1. Deliberately not a resolution
   * *time*: there is no resolvedAt column, so this says how much of the slice is
   * settled and nothing about how fast it got there.
   */
  settledShare: number;
}

/**
 * One column of the volume chart.
 *
 * Status keys are flat rather than nested because Recharts addresses a stacked
 * series by `dataKey` — this lets the chart say `dataKey={TICKET_STATUS.Open}`
 * instead of restating the string.
 */
export type TicketVolumePoint = {
  /**
   * Bucket start as a plain calendar date, `YYYY-MM-DD`, already truncated in
   * UTC. Deliberately not an instant: an ISO timestamp re-parsed in a negative
   * offset renders as the previous day, so half the world would see every
   * bucket labelled one day early.
   */
  bucketStart: string;
} & StatusCounts;

export interface TicketCategoryCount {
  /** null is the real "uncategorised" state, not a missing value. */
  category: TicketCategory | null;
  count: number;
}

export interface FirstResponseStats {
  /** Tickets in the slice with at least one outbound message. */
  responded: number;
  /**
   * Tickets in the slice with none. They have no latency, so they are absent
   * from the buckets and the median and reported separately — a median of forty
   * minutes across the tickets anyone answered is not a good first-response time
   * if twice as many were ignored.
   */
  awaiting: number;
  /** null when nothing in the slice was ever replied to. */
  medianHours: number | null;
  p90Hours: number | null;
  buckets: Record<LatencyBucket, number>;
}

export interface BacklogAgeStats {
  /** Open tickets in the slice — the denominator for the buckets. */
  open: number;
  medianAgeHours: number | null;
  buckets: Record<AgeBucket, number>;
}

export interface WorkloadCounts extends StatusCounts {
  total: number;
}

export interface AgentWorkload extends WorkloadCounts {
  id: string;
  name: string;
}

export interface CustomerStats {
  email: string;
  /**
   * The name on their most recent ticket. The same address can arrive under
   * several spellings, and the latest is the one an agent will recognise.
   */
  name: string;
  total: number;
  open: number;
  lastMessageAt: string;
}

export interface NeedsAttentionTicket {
  id: number;
  subject: string;
  customerName: string;
  assignedTo: TicketAssignee | null;
  lastMessageAt: string;
  createdAt: string;
  /**
   * The thread's last word is the customer's, or there is no thread at all, so
   * the ball is on our side. Derived from `direction` — the only signal the
   * schema carries for this.
   */
  waitingOnUs: boolean;
}

/**
 * Everything the dashboard draws, for one slice.
 *
 * One response rather than one per panel: the range and scope controls scope
 * every panel at once, and separate requests would land at separate moments,
 * leaving the KPI row describing a different slice than the chart beside it.
 */
export interface TicketStatsResponse {
  /**
   * Echoed back — the server picks the bucket width and pins the window, and the
   * card subtitles quote both.
   */
  range: DashboardRange;
  scope: DashboardScope;
  bucket: DashboardBucket;
  /** Slice bounds, `[from, to)`, ISO. Every panel below uses exactly these. */
  from: string;
  to: string;
  summary: TicketStatsSummary;
  volume: TicketVolumePoint[];
  categories: TicketCategoryCount[];
  firstResponse: FirstResponseStats;
  backlogAge: BacklogAgeStats;
  /**
   * Agents by ticket count, including those with zero in the slice — an idle
   * agent is information, so they are not filtered out.
   */
  workload: AgentWorkload[];
  /** Tickets nobody owns. Not an agent, so not a row in `workload`. */
  unassigned: WorkloadCounts;
  topCustomers: CustomerStats[];
  needsAttention: NeedsAttentionTicket[];
}

/**
 * The unattended path a ticket takes, as six stops in order.
 *
 * This is the pipeline `/pipeline` draws, and it is not a new idea about the
 * system — it is the existing one written down. Every stop corresponds to a
 * decision already made in code: `jobs/classify-ticket.ts` reaches `classified`,
 * the three gates at the top of `jobs/auto-reply-ticket.ts` decide `eligible`,
 * `ai/auto-reply.ts` produces `drafted` and then runs the checks that decide
 * `checked`, and the transaction at the bottom of the job writes `resolved`.
 *
 * Declaration order is render order, top to bottom.
 */
export const PIPELINE_STAGE = {
  /** The email arrived and a ticket exists. Nothing leaves the rail here. */
  received: "received",
  /** The classifier reached a verdict and filed a category. */
  classified: "classified",
  /** It passed the three gates that run before the model is called. */
  eligible: "eligible",
  /** The model was asked, and returned something. */
  drafted: "drafted",
  /** What it wrote survived the grounding checks. */
  checked: "checked",
  /** Answered from the knowledge base and resolved. The only calm exit. */
  resolved: "resolved",
} as const;

export type PipelineStage = (typeof PIPELINE_STAGE)[keyof typeof PIPELINE_STAGE];

/** Render order. A `const` array so the page never has to restate it. */
export const PIPELINE_STAGES = [
  PIPELINE_STAGE.received,
  PIPELINE_STAGE.classified,
  PIPELINE_STAGE.eligible,
  PIPELINE_STAGE.drafted,
  PIPELINE_STAGE.checked,
  PIPELINE_STAGE.resolved,
] as const;

/**
 * Where each decline reason leaves the rail.
 *
 * A `Record` over the whole union rather than a lookup with a fallback, and that
 * is the point of it: adding a tenth reason to `AUTO_REPLY_DECLINE` is a
 * compile error here until somebody says where it belongs on the diagram. The
 * same trick `RETRYABLE` plays in `jobs/ai-retry.ts`, for the same reason — a
 * picture of the pipeline that quietly stops matching the pipeline is worse than
 * no picture.
 *
 * Read the groupings, because they are the interesting part:
 *
 * - Three at `eligible` are the gates that run **before** the model is called.
 *   They cost nothing and they are structural.
 * - One at `drafted` is the model's own verdict — the common, correct decline.
 * - **Four at `checked` are the ones where a reply was written and destroyed.**
 *   That is a different fact from the model declining to write one, and it is
 *   the group worth watching: two of these are the checks that beat the prompt
 *   7-of-9 and 10-of-10 in the measurements recorded in `ai/auto-reply.ts`.
 *
 * `unavailable` sits at `drafted` because that is where the attempt died, but it
 * is the one entry here that is **not a verdict about the ticket** — the
 * provider could not be reached, so nothing was ever decided. Its label says so.
 */
export const DECLINE_STAGE: Record<AutoReplyDecline, PipelineStage> = {
  [AUTO_REPLY_DECLINE.category]: PIPELINE_STAGE.eligible,
  [AUTO_REPLY_DECLINE.answered]: PIPELINE_STAGE.eligible,
  [AUTO_REPLY_DECLINE.noText]: PIPELINE_STAGE.eligible,
  [AUTO_REPLY_DECLINE.notCovered]: PIPELINE_STAGE.drafted,
  [AUTO_REPLY_DECLINE.unavailable]: PIPELINE_STAGE.drafted,
  [AUTO_REPLY_DECLINE.noCitation]: PIPELINE_STAGE.checked,
  [AUTO_REPLY_DECLINE.unbackedCommitment]: PIPELINE_STAGE.checked,
  [AUTO_REPLY_DECLINE.unbackedReference]: PIPELINE_STAGE.checked,
  [AUTO_REPLY_DECLINE.tooLong]: PIPELINE_STAGE.checked,
};

/**
 * Render order for the declines within a stage, and the whole list elsewhere.
 *
 * `Object.keys` on the record above would order by insertion, which happens to
 * be right today and would silently stop being right the moment somebody sorted
 * the object. This is the list the rail iterates.
 */
export const AUTO_REPLY_DECLINES = [
  AUTO_REPLY_DECLINE.category,
  AUTO_REPLY_DECLINE.answered,
  AUTO_REPLY_DECLINE.noText,
  AUTO_REPLY_DECLINE.notCovered,
  AUTO_REPLY_DECLINE.unavailable,
  AUTO_REPLY_DECLINE.noCitation,
  AUTO_REPLY_DECLINE.unbackedCommitment,
  AUTO_REPLY_DECLINE.unbackedReference,
  AUTO_REPLY_DECLINE.tooLong,
] as const;

/**
 * Whether this deployment runs the unattended path at all, and how far.
 *
 * Presence booleans and one count — never an env value, never a key or a prefix
 * of one. Three of these being false is the difference between "a quiet week"
 * and "the lower half of this diagram is dead", and until this existed there was
 * no way to tell those apart from any screen in the app.
 */
export interface PipelineConfig {
  /** `OPENAI_API_KEY` is set. False means nothing below `received` ever runs. */
  aiConfigured: boolean;
  /** The `AUTO_REPLY_ENABLED` kill switch is not off. */
  autoReplyEnabled: boolean;
  /** Live, non-archived, `autoReply: true` articles. Zero means the same as off. */
  autoReplyArticleCount: number;
  /** Whether `POST /api/pipeline/simulate` will accept anything. */
  simulatorEnabled: boolean;
}

/**
 * The raw facts the overview reports. Stage numbers are **derived** from these
 * by `pipelineStageCounts` rather than sent, so the arithmetic exists once.
 */
export interface PipelineCounts {
  /** Tickets created inside the window. The top of the rail. */
  received: number;
  /** Of those, filed by the classifier — `classifiedAt` and `category` both set. */
  machineClassified: number;
  /** Attempted and given up on: `classifiedAt` set, `category` still null. */
  classifyAbandoned: number;
  /** Neither yet. In flight, queued, or never offered. */
  classifyPending: number;
  /** Answered from the knowledge base and resolved. */
  autoResolved: number;
  /** Every decline reason, including the zeroes — a zero is information here. */
  declines: Record<AutoReplyDecline, number>;
}

/** How many tickets were still on the rail at each stop. */
export type PipelineStageCounts = Record<PipelineStage, number>;

/**
 * Derive the six stop counts from the raw facts.
 *
 * Here rather than in the API because the rail draws both the aggregate and the
 * arithmetic that produced it, and two implementations of "how many were still
 * on the rail" would disagree on exactly the day somebody cared. Each stop is
 * the one above it minus what left there — which is also the sentence the page
 * is trying to say out loud.
 */
export function pipelineStageCounts(
  counts: PipelineCounts,
): PipelineStageCounts {
  const declinedAt = (stage: PipelineStage) =>
    AUTO_REPLY_DECLINES.filter((d) => DECLINE_STAGE[d] === stage).reduce(
      (sum, d) => sum + counts.declines[d],
      0,
    );

  const received = counts.received;
  const classified = counts.machineClassified;
  const eligible = classified - declinedAt(PIPELINE_STAGE.eligible);
  const drafted = eligible;
  const checked = drafted - declinedAt(PIPELINE_STAGE.drafted);

  return {
    [PIPELINE_STAGE.received]: received,
    [PIPELINE_STAGE.classified]: classified,
    [PIPELINE_STAGE.eligible]: eligible,
    [PIPELINE_STAGE.drafted]: drafted,
    [PIPELINE_STAGE.checked]: checked,
    [PIPELINE_STAGE.resolved]: counts.autoResolved,
  };
}

/**
 * How far one ticket got, as a verdict.
 *
 * `notOffered` is the honest answer for a ticket nothing will ever pick up —
 * no API key, the switch off, an empty corpus — and it exists so the page never
 * draws a ticket as "still thinking" about work that is not scheduled.
 */
export const PIPELINE_OUTCOME = {
  pending: "pending",
  resolved: "resolved",
  declined: "declined",
  /** The classifier exhausted its retries. Nothing downstream was ever asked. */
  abandoned: "abandoned",
  /** Nothing will run: the feature is off, unkeyed, or has no corpus. */
  notOffered: "notOffered",
} as const;

export type PipelineOutcome =
  (typeof PIPELINE_OUTCOME)[keyof typeof PIPELINE_OUTCOME];

/** What happened at one stop, for one ticket. */
export const PIPELINE_STAGE_STATE = {
  /** Reached and passed. */
  done: "done",
  /** The ticket is here now. At most one stop is ever active. */
  active: "active",
  /** The ticket left the rail here. */
  exited: "exited",
  /** Not reached yet. */
  pending: "pending",
  /** Never will be — everything below an exit. */
  skipped: "skipped",
} as const;

export type PipelineStageState =
  (typeof PIPELINE_STAGE_STATE)[keyof typeof PIPELINE_STAGE_STATE];

export interface PipelineStageResult {
  stage: PipelineStage;
  state: PipelineStageState;
  /**
   * When it happened, where a column records it — `createdAt`, `classifiedAt`,
   * `autoResolvedAt`, `autoReplyDeclinedAt`. Null everywhere else, and that is
   * not an omission: a successful reply stamps one instant for the whole
   * auto-reply job, so `drafted` and `checked` have no separate time to report
   * and this says so rather than inventing one.
   */
  at: string | null;
}

/**
 * How much work one queue is holding, split the way pg-boss splits it.
 *
 * Three numbers rather than one total, because they mean different things and
 * the difference is the whole diagnostic value. `ready` is a genuine backlog:
 * jobs runnable now that nobody has picked up. `deferred` is the retry ladder
 * doing its job — jobs waiting out a backoff after a transient provider failure,
 * which is the system working, not falling behind. A single "pending" number
 * would average those two into a figure that means neither.
 */
export interface PipelineQueueDepth {
  /** Runnable right now and unclaimed. */
  ready: number;
  /** Held by a worker at this instant. */
  active: number;
  /** Waiting out a retry backoff, not yet runnable. */
  deferred: number;
}

export interface PipelineQueues {
  classify: PipelineQueueDepth;
  autoReply: PipelineQueueDepth;
}

/** One ticket's trip down the rail, rebuilt from the columns it left behind. */
export interface PipelineRun {
  ticketId: number;
  subject: string;
  customerName: string;
  status: TicketStatus;
  category: TicketCategory | null;
  createdAt: string;
  outcome: PipelineOutcome;
  /** Set only when `outcome` is `declined`. */
  decline: AutoReplyDecline | null;
  declinedAt: string | null;
  /** Set only when `outcome` is `resolved` — the articles the reply was built from. */
  citedArticleIds: string[];
  stages: PipelineStageResult[];
}

export interface PipelineOverviewResponse {
  config: PipelineConfig;
  /** Echoed: the server pins the window and the page quotes it. */
  range: DashboardRange;
  from: string;
  to: string;
  counts: PipelineCounts;
  /**
   * What each queue is holding right now. The one thing on this page the ticket
   * table genuinely cannot produce — a backlog here means the pipeline is
   * behind, which looks identical from every other screen to nothing happening.
   */
  queues: PipelineQueues;
  /** Most recent arrivals with their verdicts, newest first. */
  recent: PipelineRun[];
}

export interface PipelineRunResponse {
  run: PipelineRun;
}

export interface PipelineSimulateResponse {
  ticketId: number;
  /** True when the email threaded onto an existing ticket instead of opening one. */
  threaded: boolean;
  /**
   * The `Message-ID` this email was stored under.
   *
   * Returned so the simulator can offer "reply to this thread" without anyone
   * hunting for an id — which is the only practical way to demonstrate the
   * `answered` gate, since that gate only fires on a ticket that already has a
   * reply. The id is minted server-side and is on the reserved domain, so
   * handing it back reveals nothing that was not just created.
   */
  messageId: string;
}

/** How many runs the overview carries. Named here because the heading quotes it. */
export const PIPELINE_RECENT_LIMIT = 12;

/**
 * The domain every simulated sender is forced onto.
 *
 * `example.com` and its subdomains are reserved by RFC 2606, so a simulated
 * ticket can never cause mail to reach a real person once Phase 3's transport
 * lands. The client sends a localpart and the server builds the address; this
 * constant is shared so the form can show the address it is going to get.
 *
 * The **display name** is deliberately not constrained — it is the one piece of
 * attacker-controlled text `ai/auto-reply.ts` has to neutralise (`greetingName`),
 * and being able to type a hostile one is how you watch it work.
 */
export const SIMULATED_SENDER_DOMAIN = "sim.example.com";

/**
 * What became of one email this desk meant to send.
 *
 * Mirrors the `OutboundEmailStatus` enum in the schema. `undeliverable` is the
 * one that needs saying out loud: it means no mail provider is configured, so
 * nothing was attempted. That is a supported state — the state this app runs in
 * today — and not a failure, which is why it is not folded into `failed`.
 */
export const OUTBOUND_EMAIL_STATUS = {
  queued: "queued",
  sent: "sent",
  failed: "failed",
  undeliverable: "undeliverable",
} as const;

export type OutboundEmailStatus =
  (typeof OUTBOUND_EMAIL_STATUS)[keyof typeof OUTBOUND_EMAIL_STATUS];

/** What an outbound email is for. Mirrors `OutboundEmailKind` in the schema. */
export const OUTBOUND_EMAIL_KIND = {
  reply: "reply",
  passwordReset: "passwordReset",
  invitation: "invitation",
} as const;

export type OutboundEmailKind =
  (typeof OUTBOUND_EMAIL_KIND)[keyof typeof OUTBOUND_EMAIL_KIND];

/**
 * One row of the outbox, as the admin screen sees it.
 *
 * **`textBody` is included, and that is the point of the screen.** With no mail
 * provider bound, this is how an invitation reaches a new colleague: an admin
 * reads the link off the page. It is also why the route behind it is
 * admin-only — an invitation body contains a working single-use credential
 * until it expires.
 */
export interface OutboundEmailRow {
  id: number;
  kind: OutboundEmailKind;
  status: OutboundEmailStatus;
  toEmail: string;
  toName: string | null;
  subject: string;
  textBody: string;
  /** The ticket this reply belongs to, so the screen can link to the thread. */
  ticketId: number | null;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
}

export interface OutboxListResponse {
  emails: OutboundEmailRow[];
  /** Rows matching the filter, which may exceed the page returned. */
  total: number;
}
