import { USER_ROLE } from "@ticket/shared";
import type { Session } from "../middleware/auth";

/**
 * Who may look at the admin screens, and who may only look (#320, R3).
 *
 * A demo visitor sees every admin screen except Users and Outbox, and that
 * access comes from **this** check, keyed on `isAnonymous` — never from the
 * `admin` role. The admin plugin serves `/api/auth/admin/*` (set role, remove
 * user, impersonate) to `adminRoles` without passing through any guard of this
 * repo's, so a demo holding `admin` would reach those directly (ADR-0022).
 *
 * Its own module, beside `mode.ts`, rather than inside `middleware/auth.ts`:
 * that file imports `../auth`, which every route test replaces, so a rule
 * written there could only be tested through a stub of itself. At runtime this
 * one imports nothing but `@ticket/shared`, which nothing mocks; the session
 * type below is erased.
 */

/**
 * The two session fields the decision reads, taken from Better Auth's own
 * session type by name (conventions.md): `isAnonymous` is the `anonymous`
 * plugin's, and a plugin upgrade that renamed it fails to compile here rather
 * than quietly shutting every demo out.
 */
export type AdminViewer = Pick<Session["user"], "role" | "isAnonymous">;

/**
 * The methods a demo session may send to an admin view. Reads only: the plan
 * keeps every admin write shut to a stranger, so the nightly reset never has to
 * undo one (R5).
 */
const DEMO_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"]);

/**
 * An admin, or a demo visitor. Also decides which realtime events a stream
 * hears: an event must never outrun the endpoint it points at, and a demo can
 * read the pipeline and eval runs those events are about.
 */
export function seesAdminScreens(user: AdminViewer): boolean {
  return user.role === USER_ROLE.admin || user.isAnonymous === true;
}

/**
 * `requireAdminView`'s rule: an admin may do anything, a demo visitor may only
 * read. The method check is belt and braces — the guard is only mounted on
 * `GET` routes — so a write mistakenly given this guard still refuses a demo.
 */
export function mayUseAdminView(user: AdminViewer, method: string): boolean {
  if (user.role === USER_ROLE.admin) return true;
  return user.isAnonymous === true && DEMO_METHODS.has(method);
}
