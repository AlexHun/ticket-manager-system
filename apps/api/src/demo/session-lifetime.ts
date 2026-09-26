/**
 * How long a demo session lasts, and when one is refused (#324, PRD R7, R2).
 *
 * A leaf beside `mode.ts`, for its reason: `auth.ts` applies these and cannot
 * always be loaded by a unit test, and nothing mocks a module that imports only
 * another leaf. See `docs/adr/0022-a-demo-session-is-an-anonymous-agent.md`.
 */
import { isDemoModeEnabled } from "./mode";

/** Two hours from the start, not from the last request (R7). */
export const DEMO_SESSION_MS = 2 * 60 * 60 * 1000;

/** When a demo session that started at `startedAt` ends. */
export function demoSessionEndsAt(startedAt: Date): Date {
  return new Date(startedAt.getTime() + DEMO_SESSION_MS);
}

/**
 * Whether a session `/get-session` is about to answer with must be refused
 * instead: a demo identity's, once demo mode is off or two hours after it
 * started. Anybody else's never is.
 *
 * Read off `createdAt` rather than `expiresAt` so the two hours hold for a
 * session whose row says otherwise — one opened before this rule shipped
 * carries Better Auth's week.
 */
export function demoSessionRefused(
  user: { isAnonymous?: boolean | null },
  session: { createdAt: Date | string },
  now: number = Date.now(),
): boolean {
  if (user.isAnonymous !== true) return false;
  if (!isDemoModeEnabled()) return true;
  return now >= demoSessionEndsAt(new Date(session.createdAt)).getTime();
}
