import { BRAND_NAME } from "@ticket/shared";

/** What `authFailure` says for a server fault or an unreachable server. */
export const AUTH_UNREACHABLE_MESSAGE = `Couldn't reach ${BRAND_NAME}. Check your connection, or try again in a moment.`;

/** The part of a Better Auth `error` the wrapper reads. */
type AuthError = { status?: number };

/** A page's own sentences for a failed auth call. */
export interface AuthFailureCopy {
  /** What any refusal the page does not name gets. */
  fallback: string;
  /** The page's sentences for statuses of its own, such as 429. */
  byStatus?: Partial<Record<number, string>>;
}

/**
 * Makes a Better Auth call and says what to show if it failed: `null` on
 * success, otherwise the sentence (#747). Sign-in, the demo start and choosing
 * a password from a link each call through it, so none of them catches or
 * reads a status itself; #537 and #739 were each a call site missing one of
 * the steps below.
 *
 * In order:
 * 1. A call that rejects is unreachable. An unreachable server is no `error`:
 *    the client rejects with fetch's own TypeError, and a request that never
 *    got an answer says nothing about what was typed (#739).
 * 2. Status 0 or a 5xx is unreachable too. Neither says anything about what
 *    was typed, and answering a login's 500 with "Couldn't sign you in" sent
 *    someone off to reset a password that was never the problem (#537).
 * 3. A status the page names gets the page's sentence for it.
 * 4. Anything else gets the page's `fallback`.
 *
 * A missing status is not unreachable. It is absence of evidence, not
 * evidence of a transport failure, and Better Auth returns a plain refused
 * credential with no status in some paths, which "unreachable" would answer
 * by blaming the network.
 *
 * Better Auth's own `message` is worded its own way ("Invalid email or
 * password"), not the copy standard's, so it is never shown: every sentence
 * but `AUTH_UNREACHABLE_MESSAGE` comes from the page's `copy`.
 */
export async function authFailure(
  call: () => Promise<{ error: AuthError | null }>,
  copy: AuthFailureCopy,
): Promise<string | null> {
  let error: AuthError | null;
  try {
    ({ error } = await call());
  } catch {
    return AUTH_UNREACHABLE_MESSAGE;
  }
  if (!error) return null;

  const status = error.status;
  if (typeof status !== "number") return copy.fallback;
  if (status === 0 || status >= 500) return AUTH_UNREACHABLE_MESSAGE;
  return copy.byStatus?.[status] ?? copy.fallback;
}
