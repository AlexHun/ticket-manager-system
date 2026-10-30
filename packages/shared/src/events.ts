import type { TicketActivityAction } from "./tickets.ts";
import { USER_ROLE, type UserRole } from "./users.ts";

/**
 * What a screen just stopped being right about.
 *
 * Deliberately **not** `TicketActivityAction`, the ticket trail in `tickets.ts`.
 * That trail answers "what does an agent reading this ticket have to account
 * for?" — durable, human-readable, mirrored by a Postgres enum. This answers
 * "what does a mounted query have to re-read?" — ephemeral, machine-read, gone
 * the moment it is applied.
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
  /**
   * An eval run started, finished, or failed.
   *
   * Admin-only for exactly the reason `pipeline_changed` is: no route in
   * `apps/api/src/routes/evals.ts` is open to an agent, and an event that
   * outran its own endpoint would be a leak no route guard could catch.
   *
   * It is also the first kind that is **not about a ticket**, which is what
   * makes `TicketEvent` below a union rather than one interface. See the note
   * there — an eval run touches no ticket at all, by construction, and an
   * event carrying a `ticketId` it made up would be the first lie on this
   * channel.
   */
  eval_run_changed: "eval_run_changed",
} as const;

export type TicketEventKind = (typeof TICKET_EVENT)[keyof typeof TICKET_EVENT];

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
/** Every event, whatever it is about: a verb and a timestamp. */
interface EventBase {
  kind: TicketEventKind;
  /** ISO. Ordering, and a "last updated" affordance on screen. */
  at: string;
}

/** The four kinds that name a ticket. */
export interface TicketScopedEvent extends EventBase {
  kind: Exclude<TicketEventKind, typeof TICKET_EVENT.eval_run_changed>;
  ticketId: number;
  /** Only on `ticket_updated`, so the client knows whether counts can have moved. */
  fields?: TicketEventField[];
}

/**
 * The one kind that names an eval run instead.
 *
 * A run is answered by handing a synthesized input straight to `autoReply`, so
 * it never reaches the code that writes a ticket and there is no ticket id to
 * put here. The alternative — reusing `ticketId` for a run id — would make the
 * field's name a lie on one branch of a union nothing forces you to narrow,
 * which is precisely the sort of thing that is discovered from a screen showing
 * the wrong ticket.
 */
export interface EvalRunEvent extends EventBase {
  kind: typeof TICKET_EVENT.eval_run_changed;
  runId: number;
}

export type TicketEvent = TicketScopedEvent | EvalRunEvent;

/**
 * The member of the union a given kind arrives as — for a handler table keyed
 * by kind.
 *
 * A conditional rather than `Extract<TicketEvent, { kind: K }>`, which yields
 * `never` here: `TicketScopedEvent` declares `kind` as the four-literal union,
 * and that is not assignable to `{ kind: "ticket_updated" }`. Splitting the
 * scoped branch into four single-kind interfaces would make `Extract` work and
 * would cost four copies of the same three fields, which is a worse trade than
 * one conditional.
 */
export type EventOfKind<K extends TicketEventKind> =
  K extends typeof TICKET_EVENT.eval_run_changed
    ? EvalRunEvent
    : TicketScopedEvent;

/**
 * Who may hear each kind.
 *
 * A `Record` over the union rather than a check at the publish site, for the same
 * reason `DECLINE_STAGE` is one: a tenth event kind is a compile error until
 * somebody says who is allowed to receive it. Getting that wrong is a disclosure
 * bug, and this is the only place it can be decided.
 *
 * `pipeline_changed` is `admin` because no route in `routes/pipeline.ts` is
 * open to an agent — an event that outran its own endpoint would be a leak that
 * no route guard could catch. `eval_run_changed` is `admin` for exactly that
 * reason, against `routes/evals.ts`. A demo session is in the `admin` audience
 * without holding the role, because it may read both (`requireAdminView`, #320).
 */
export const EVENT_AUDIENCE: Record<TicketEventKind, UserRole | "all"> = {
  ticket_created: "all",
  ticket_updated: "all",
  ticket_message: "all",
  pipeline_changed: USER_ROLE.admin,
  eval_run_changed: USER_ROLE.admin,
};
