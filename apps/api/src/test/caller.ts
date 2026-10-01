/**
 * Who a route test is asking as (#366).
 *
 * Every route test runs the real `requireAuth`, `requireAdmin` and
 * `requireAdminView`. The one thing a test supplies is the caller, and it
 * supplies it here: `src/test/preload.ts` binds `../middleware/session` to
 * `testSession` below once for the whole process, and a test names its caller
 * with `asCaller`. Nothing else in a test file touches the guards.
 *
 * **The role is the seeded row's, never a header's.** `x-test-user` names a
 * `user` row and the session is built from that row, so `role` and
 * `isAnonymous` are whatever the database says — a test cannot claim an admin
 * the table does not have, and a demo visitor is `COLLEAGUE.demoVisitor`
 * because its row says `isAnonymous`, as the real one's does. A header naming
 * no row is nobody, which is the 401 a deleted account gets.
 *
 * **There is one default caller and it lives here**, not in each file. Before
 * this, fifteen copies of the guard stub each fell back to an identity of
 * their own when the header was missing, and three disagreed. A per-file
 * default is state on a process-wide specifier, which is the registry hazard
 * in `docs/standards/testing-api.md` in another form.
 */
import type { IncomingHttpHeaders } from "node:http";
import type { Session } from "../middleware/session";
import { COLLEAGUE, type ColleagueKey } from "./fixtures";
import { callerRow } from "./pg";

const USER_HEADER = "x-test-user";
const CACHED_HEADER = "x-test-cached";

/** Who a request with no `x-test-user` header is from. */
export const DEFAULT_CALLER: ColleagueKey = "agent";

/** An id no `user` row will ever have. */
const NOBODY = "u_nobody_signed_in";

type Caller =
  | ColleagueKey
  | "nobody"
  /** A row the test seeded itself, for a caller no colleague fits. */
  | { id: string };

/**
 * The headers that make a request come from `who`.
 *
 * `cached` stands in for Better Auth's cookie cache, which serves a session
 * from its own copy for up to 60 seconds after the row behind it is deleted
 * (`docs/standards/backend.md`). It is the one way to reach a write whose
 * caller's row has gone — the rollback tests in `routes/knowledge`,
 * `routes/automation` and `routes/users` — and answers from the fixture the
 * row was seeded from, so it too cannot name a role nobody had.
 */
export function asCaller(
  who: Caller,
  options: { cached?: boolean } = {},
): Record<string, string> {
  const id =
    who === "nobody"
      ? NOBODY
      : typeof who === "string"
        ? COLLEAGUE[who].id
        : who.id;
  return {
    [USER_HEADER]: id,
    ...(options.cached ? { [CACHED_HEADER]: "true" } : {}),
  };
}

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

type UserRow = NonNullable<Awaited<ReturnType<typeof callerRow>>>;

/**
 * The cookie cache's copy of a colleague: the row as `seedColleagues` wrote
 * it, with the columns the fixture leaves to their defaults.
 */
function cachedCopy(id: string): UserRow {
  const seeded = Object.values(COLLEAGUE).find((c) => c.id === id);
  if (!seeded) {
    throw new Error(`asCaller({ cached }) names ${id}, which no fixture seeds`);
  }
  return {
    image: null,
    automated: false,
    isAnonymous: false,
    banned: false,
    banReason: null,
    banExpires: null,
    deletedAt: null,
    updatedAt: seeded.createdAt,
    ...seeded,
  };
}

/**
 * `lookupSession`, as the preload binds it: the session Better Auth would hand
 * the guard for the caller `asCaller` named.
 */
export async function testSession(
  headers: IncomingHttpHeaders,
): Promise<Session | null> {
  const id = one(headers[USER_HEADER]) ?? COLLEAGUE[DEFAULT_CALLER].id;
  const row =
    one(headers[CACHED_HEADER]) === "true"
      ? cachedCopy(id)
      : await callerRow(id);
  if (!row) return null;

  const now = new Date();
  return {
    user: row,
    session: {
      id: `sess-${row.id}`,
      userId: row.id,
      token: "test-token",
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: null,
      impersonatedBy: null,
    },
  };
}
