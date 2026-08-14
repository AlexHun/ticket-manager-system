import { randomUUID } from "node:crypto";

/**
 * The right-hand side of every Message-ID this system mints.
 *
 * RFC 5322 wants a domain the sender actually owns, so that two systems can
 * never generate the same id. Nothing is being *sent* yet — the reply endpoint
 * writes the header, it does not hand the mail to a provider — so a placeholder
 * is the honest value, and this is the one line to change when a transport
 * lands. Deliberately not an env var: there is no provider to configure it for,
 * and a required env var that nothing reads is a deployment trap.
 */
const MESSAGE_ID_DOMAIN = "tickets.example.com";

/**
 * A Message-ID for an outbound reply, stored the way the inbound webhook stores
 * one: **without** angle brackets.
 *
 * That is the load-bearing detail, not a formatting preference. When the
 * customer answers, their mail client sends `In-Reply-To: <this-id>`, and
 * `stripAngles` in `ingest.ts` takes the brackets off
 * before looking the parent up. An id stored *with* them would never match that
 * lookup, and the customer's reply would open a second ticket instead of
 * threading onto this one.
 *
 * A v4 UUID is where the uniqueness comes from; the ticket id in front is only
 * so a header in a mail log can be traced back to a thread by eye. `messageId`
 * is UNIQUE in the schema, so a collision is a failed insert rather than two
 * threads quietly merged.
 */
export function newOutboundMessageId(ticketId: number): string {
  return `${ticketId}.${randomUUID()}@${MESSAGE_ID_DOMAIN}`;
}
