import type { Prisma } from "./db";

/**
 * What the assistant decided about a ticket, each fact stated once (#561).
 *
 * `/pipeline` (`routes/pipeline.ts`) and the dashboard's effectiveness figures
 * (`routes/ticket-effectiveness.ts`) both report these, and each used to read
 * them off columns an agent can change, each in its own words. An agent who
 * cleared a category the classifier filed left `classifiedAt` set and
 * `category` null, which both screens read as the classifier giving up: an
 * outage on `/pipeline` (ADR-0019), and a ticket missing from the classified
 * figure every dashboard rate is taken over. A person correcting the machine
 * was reported as the machine failing.
 *
 * So the classifier records what it filed in `classifierCategory`, a column no
 * agent write touches, and the facts below read that. "Resolved by the
 * assistant" was read two ways as well, off the assignee on the dashboard and
 * off `autoResolvedAt` on `/pipeline` (#562); it is the stamp now, on both. Queries rather than row
 * predicates, for the reason `classifierWillStillAct` is one: every reader can
 * run a query, so the routes count with these and ask them of the tickets they
 * list, and `toRun` takes the answer rather than restating it.
 *
 * No runtime imports, so no test has anything here to stub.
 */

/**
 * The classifier filed a category on the ticket. Whatever an agent did to
 * `category` since — cleared it, re-filed it — does not change this.
 */
export const classifierFiled = {
  classifiedAt: { not: null },
  classifierCategory: { not: null },
} satisfies Prisma.TicketWhereInput;

/**
 * The classifier reached its terminal path and filed nothing: `classifiedAt`
 * stamped by the give-up branch of `handle` or by `onExhausted`, and no
 * category of its own. A category an agent filed afterwards does not make this
 * a classification.
 */
export const classifierGaveUp = {
  classifiedAt: { not: null },
  classifierCategory: null,
} satisfies Prisma.TicketWhereInput;

/**
 * The auto-reply resolved the ticket, and no customer has reopened it since
 * (#562). `autoResolvedAt` is stamped by the auto-reply's success path and
 * cleared by a customer's reply in `ingest.ts`, and nothing an agent does
 * touches it.
 *
 * Not the assignee. The resolved ticket is filed under the assistant's account,
 * but that is the routing rule, and the column an agent uses: the dashboard
 * used to count the assistant's assignments, so an agent reassigning a ticket
 * the assistant resolved took it out of the published auto-resolve rate while
 * `/pipeline` went on drawing it resolved.
 */
export const assistantResolved = {
  autoResolvedAt: { not: null },
} satisfies Prisma.TicketWhereInput;
