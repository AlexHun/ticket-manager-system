import { SESSION_STATE, type SessionState } from "./sessions-protocol";

/** A card state's badge, on a card (`./SessionsPage`) and on a chain's
 *  worker (`./SessionChains`): Running filled, Waiting for you in the primary
 *  fill that asks for the developer, Done quiet, Stopped the one that
 *  alarms. */
export const STATE_BADGE = {
  [SESSION_STATE.running]: "secondary",
  [SESSION_STATE.waiting]: "default",
  [SESSION_STATE.done]: "outline",
  [SESSION_STATE.stopped]: "destructive",
} as const satisfies Record<SessionState, string>;
