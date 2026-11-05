import { BRAND_NAME } from "@ticket/shared";

/** What `failureMessage` says for a server fault or an unreachable server. */
export const AUTH_UNREACHABLE_MESSAGE = `Couldn't reach ${BRAND_NAME}. Check your connection, or try again in a moment.`;

/**
 * What a Better Auth call that rejects is read as: `call().catch(() =>
 * UNREACHABLE_RESULT)`. An unreachable server is no `error` — the client
 * rejects with fetch's own TypeError — and a request that never got an answer
 * says nothing about what was typed, so any rejection is read as status 0,
 * which `failureMessage` answers as unreachable (#537, #739).
 */
export const UNREACHABLE_RESULT = { error: { status: 0 } };

/**
 * What to say when Better Auth turns a request down, shared by the pages that
 * call it (#537).
 *
 * A server fault (5xx) and a server that cannot be reached at all (status 0)
 * need different words from a rejected request: neither says anything about
 * what was typed. An unreachable server arrives as `UNREACHABLE_RESULT`'s
 * status 0. Answering either with "Couldn't sign you in" sends someone off to
 * reset a password that was never the problem — which is exactly what happened
 * on the login page when the API was down and sign-in returned 500.
 *
 * Only when the status positively says so. A missing status is absence of
 * evidence, not evidence of a transport failure, and defaulting it to
 * "unreachable" would answer a plain rejected credential — which is what
 * Better Auth returns with no status in some paths — by blaming the network.
 *
 * Better Auth's own `message` is worded its own way ("Invalid email or
 * password"), not the copy standard's, so a caller passes its own sentence as
 * `fallback` rather than that message. Neither `LoginPage` nor
 * `ResetPasswordPage` shows it, which each page's test holds.
 */
export function failureMessage(
  error: { status?: number },
  fallback: string,
): string {
  const status = error.status;
  const unreachable =
    typeof status === "number" && (status === 0 || status >= 500);

  return unreachable ? AUTH_UNREACHABLE_MESSAGE : fallback;
}
