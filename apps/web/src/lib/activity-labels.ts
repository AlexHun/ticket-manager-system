import {
  asAutoReplyDecline,
  TICKET_ACTIVITY_ACTION,
  TICKET_ACTOR_KIND,
  type TicketActivity,
  type TicketActivityAction,
} from "@ticket/shared";
import { DECLINE_SHORT } from "./pipeline-labels";

/**
 * How one recorded change reads in the thread.
 *
 * A `Record` over the action union, so a new action cannot be added without
 * somebody deciding how it reads — the same forcing function `DECLINE_STAGE` and
 * `RETRYABLE` are, applied to the one part of an audit trail that is easy to
 * leave until later and impossible to reconstruct afterwards.
 *
 * Each returns the *predicate* only. The actor's name is rendered before it, so
 * the sentence is built once in the component rather than repeated eight times
 * here — and so an entry always says who, which is the whole point of the table.
 *
 * In the web app rather than in `@ticket/shared` for the reason `pipeline-labels`
 * is: wording is a property of this UI, and the API has no business carrying a
 * sentence it never renders. What is shared is the data — the action, the two
 * values and the actor.
 */
export const ACTIVITY_PHRASING: Record<
  TicketActivityAction,
  (entry: TicketActivity) => string
> = {
  [TICKET_ACTIVITY_ACTION.created]: () => "opened this ticket",

  [TICKET_ACTIVITY_ACTION.status_changed]: (entry) =>
    `moved this from ${entry.fromValue} to ${entry.toValue}`,

  [TICKET_ACTIVITY_ACTION.category_changed]: (entry) => {
    if (entry.toValue === null) return "cleared the category";
    // No previous value means nobody had filed it — every ticket arrives
    // uncategorised, so this is the common one and reads better than a
    // "from nothing to Technical" construction.
    if (entry.fromValue === null) return `filed this under ${entry.toValue}`;
    return `refiled this from ${entry.fromValue} to ${entry.toValue}`;
  },

  // Two grammars, and the difference is not stylistic. Only an agent *chooses*
  // an assignee. When a customer's reply reopens a machine-resolved ticket the
  // handoff setting re-routes it, and saying "Priya Raman reassigned this to
  // Admin" credits a customer with a decision they had no part in and could not
  // see — in the one record that exists to say who decided what.
  [TICKET_ACTIVITY_ACTION.assignee_changed]: (entry) => {
    if (entry.actorKind === TICKET_ACTOR_KIND.agent) {
      if (entry.toValue === null) return "unassigned this ticket";
      if (entry.fromValue === null) return `assigned this to ${entry.toValue}`;
      return `reassigned this from ${entry.fromValue} to ${entry.toValue}`;
    }

    if (entry.toValue === null) return "replied — the ticket became unassigned";
    if (entry.fromValue === null)
      return `replied — the ticket passed to ${entry.toValue}`;
    return `replied — the ticket passed from ${entry.fromValue} to ${entry.toValue}`;
  },

  // The actor is the customer, so this reads "Marta Kowalski replied, …". The
  // reply itself is a message in the thread a few pixels away; what this line
  // adds is that it undid a resolution, which the bubble alone does not say.
  [TICKET_ACTIVITY_ACTION.reopened]: () => "replied, reopening this ticket",

  [TICKET_ACTIVITY_ACTION.auto_resolved]: () =>
    "answered this from the knowledge base and resolved it",

  // The reason is the entire value of this entry — `/pipeline` has always
  // counted declines in aggregate, and the ticket in front of the agent never
  // said which one it hit. Narrowed on the way in like every other stored
  // decline reason: `toValue` is a free-text column, so a reason written by an
  // older build or since renamed reads as no reason rather than as a raw key.
  [TICKET_ACTIVITY_ACTION.auto_declined]: (entry) => {
    const decline = asAutoReplyDecline(entry.toValue);
    return decline
      ? `left this for a human — ${DECLINE_SHORT[decline]}`
      : "left this for a human";
  },
};
