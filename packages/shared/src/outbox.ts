/**
 * What became of one email this desk meant to send.
 *
 * Mirrors the `OutboundEmailStatus` enum in the schema. `undeliverable` is the
 * one that needs saying out loud: it means no mail provider is configured, so
 * nothing was attempted. That is a supported state — the state this app runs in
 * today — and not a failure, which is why it is not folded into `failed`.
 * `withheld` is a demo session's email (#325): recorded, and never sent by
 * anything, the outbox retry included.
 */
export const OUTBOUND_EMAIL_STATUS = {
  queued: "queued",
  sent: "sent",
  failed: "failed",
  undeliverable: "undeliverable",
  withheld: "withheld",
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
