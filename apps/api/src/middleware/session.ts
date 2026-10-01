import type { IncomingHttpHeaders } from "node:http";
import { isAPIError } from "better-auth/api";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../auth";

export type Session = NonNullable<
  Awaited<ReturnType<typeof auth.api.getSession>>
>;

/**
 * A 401 from `getSession` is no session: it is how `auth.ts` ends a demo
 * session two hours in or once demo mode is off (#324), thrown because a hook
 * cannot answer `null`. Anything else is a fault, and goes on to the error
 * handler as it always did.
 */
function noSessionOn401(err: unknown): null {
  if (isAPIError(err) && err.statusCode === 401) return null;
  throw err;
}

/**
 * Who is asking: the one question the guards in `./auth` put to Better Auth
 * (#366).
 *
 * Its own module so that a test can answer it and nothing else. The guards run
 * for real in every route test; `src/test/preload.ts` replaces this function
 * once for the whole process with `src/test/caller.ts`'s, which reads the
 * seeded `user` row an `x-test-user` header names. That is also why `../auth`
 * is imported here and nowhere in `./auth`: it throws at import without its
 * two secrets, and a module the preload has replaced is never evaluated.
 *
 * A function, never a re-export of `auth.api.getSession`, for the reason
 * `docs/standards/testing-api.md` gives (#303).
 */
export function lookupSession(
  headers: IncomingHttpHeaders,
): Promise<Session | null> {
  return auth.api
    .getSession({ headers: fromNodeHeaders(headers) })
    .catch(noSessionOn401);
}
