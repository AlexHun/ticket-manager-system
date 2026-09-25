import type { UserRole } from "@ticket/shared";

/**
 * Who is looking, as the navigation and the admin gate need to know it.
 *
 * A demo session (#320) holds the `agent` role and still sees the showcase
 * admin screens, so the role alone no longer answers "which screens". The API
 * keeps the same split in `apps/api/src/demo/admin-view.ts`; this half is UX,
 * and `requireAdmin` / `requireAdminView` are the control.
 */
export interface Viewer {
  role: UserRole | undefined;
  /** Signed in through "Use demo session" — Better Auth's `isAnonymous`. */
  demo: boolean;
}

export function viewerOf(
  user: { role?: UserRole | null; isAnonymous?: boolean | null } | undefined,
): Viewer {
  return { role: user?.role ?? undefined, demo: user?.isAnonymous === true };
}
