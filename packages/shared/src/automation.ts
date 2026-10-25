import type { TicketAssignee } from "./tickets.ts";

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
