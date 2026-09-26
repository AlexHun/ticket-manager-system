import type { UserRole } from "@ticket/shared";
import type { authClient } from "@/lib/auth-client";

/**
 * The two session fields `viewerOf` reads, taken from the auth client's own
 * inferred session by name (conventions.md), so a plugin upgrade that renamed
 * `isAnonymous` fails to compile here rather than hiding the showcase screens.
 */
type SessionViewer = Pick<
  typeof authClient.$Infer.Session.user,
  "role" | "isAnonymous"
>;

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

export function viewerOf(user: SessionViewer | undefined): Viewer {
  return { role: user?.role ?? undefined, demo: user?.isAnonymous === true };
}
