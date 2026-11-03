import { BRAND_NAME } from "@ticket/shared";

/**
 * What to say when Better Auth turns a request down, for any page that calls
 * it: `LoginPage`'s two ways in and `ResetPasswordPage`'s submit (#537).
 *
 * Better Auth reports the transport failure and the rejected request through
 * the same channel, and they need different words. A network failure arrives
 * with no status at all; a server fault arrives as 5xx. Neither says anything
 * about what was typed, and answering both with "Couldn't sign you in"
 * sends someone off to reset a password that was never the problem — which is
 * exactly what happened here when the API was down and sign-in returned 500.
 *
 * Only when the status positively says so. A missing status is absence of
 * evidence, not evidence of a transport failure, and defaulting it to
 * "unreachable" would answer a plain rejected credential — which is what
 * Better Auth returns with no status in some paths — by blaming the network.
 *
 * Better Auth's own `message` is never shown: it is worded its own way
 * ("Invalid email or password"), not the copy standard's, so every refusal
 * the page can name gets the page's sentence and the rest get `fallback`.
 */
export function failureMessage(
  error: { status?: number },
  fallback: string,
): string {
  const status = error.status;
  const unreachable =
    typeof status === "number" && (status === 0 || status >= 500);

  return unreachable
    ? `Couldn't reach ${BRAND_NAME}. Check your connection, or try again in a moment.`
    : fallback;
}
