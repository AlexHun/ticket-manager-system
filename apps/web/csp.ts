/**
 * The page's Content-Security-Policy, in one place.
 *
 * This file exists because the policy now has **three** consumers and they must
 * not be allowed to drift apart:
 *
 * 1. `vite.config.ts` injects it as a build-time `<meta>` tag, minus
 *    `frame-ancestors` (browsers ignore that one in a meta tag and log a
 *    warning);
 * 2. `vite preview` serves it as a real header, which is the reference for
 *    what production should do;
 * 3. **production actually does it now** — `apps/web/Caddyfile` sets the header
 *    on every response, reading the policy out of `csp.caddy`, which the build
 *    emits from `cspPolicy()` below.
 *
 * Three hand-maintained copies of a security header is the arrangement where
 * the one that matters is the one nobody remembered to update. There is one
 * definition and the other two are generated from it.
 *
 * This is containment, not the primary defence. Message bodies render as React
 * text nodes and the API never sends the inbound `htmlBody` at all — it is left
 * out of `MESSAGE_SELECT` in `apps/api/src/routes/tickets.ts` and out of the
 * `ThreadMessage` wire type, so attacker-supplied email markup cannot reach the
 * DOM today. This is what limits the damage on the day some future change makes
 * that untrue.
 */

/**
 * One directive per entry.
 *
 * `apiOrigin` is where the API lives: a separate origin in production, empty in
 * dev and in tests where Vite proxies `/api`. It has to be listed or every
 * request the app makes is blocked.
 *
 * `sentryOrigin` is the same story with a sharper failure mode: an unlisted
 * ingest host means the browser blocks every error report, and the only trace is
 * a CSP violation in the console of the session that broke — so the tool meant
 * to tell you about failures fails silently, in exactly the case you needed it.
 * Empty when `VITE_SENTRY_DSN` is unset, which is also when nothing tries to
 * send.
 */
export function cspDirectives(
  apiOrigin: string,
  sentryOrigin: string,
): string[] {
  const connectSources = ["'self'", apiOrigin, sentryOrigin].filter(Boolean);

  return [
    "default-src 'self'",
    // The directive that would actually stop an XSS. It costs nothing here: the
    // built index.html loads one external module script and carries no inline
    // script of its own, so no nonce or hash plumbing is needed. Check that is
    // still true of `dist/index.html` before relaxing this.
    "script-src 'self'",
    // Inline *styles* have to be allowed, and are a far weaker vector. shadcn's
    // chart wrapper injects a <style> element for the per-chart colour
    // variables, and Radix, Recharts and sonner all write style attributes as
    // they position and animate things. Without 'unsafe-inline' every popover,
    // toast and chart in the app breaks.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    // Geist is bundled by @fontsource-variable and emitted into /assets, so
    // there is no font CDN to allow.
    "font-src 'self'",
    `connect-src ${connectSources.join(" ")}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
}

/** The full policy as a header value. */
export function cspPolicy(apiOrigin: string, sentryOrigin: string): string {
  return cspDirectives(apiOrigin, sentryOrigin).join("; ");
}

/**
 * The policy a `<meta http-equiv>` tag may carry.
 *
 * `frame-ancestors` is dropped because a meta tag cannot express it — browsers
 * ignore it there and warn. That directive only exists on the real header, which
 * is why a host that can set headers is strictly better than the tag, and why
 * the Caddyfile is not optional decoration.
 */
export function cspMetaPolicy(apiOrigin: string, sentryOrigin: string): string {
  return cspDirectives(apiOrigin, sentryOrigin)
    .filter((directive) => !directive.startsWith("frame-ancestors"))
    .join("; ");
}

/**
 * `VITE_API_URL` reduced to a bare origin, which is the only form a CSP source
 * accepts. Empty when the API is same-origin — either unset (dev, behind the
 * proxy) or a relative path, both of which `'self'` already covers.
 */
export function apiOriginFrom(apiUrl: string): string {
  if (!apiUrl) return "";
  try {
    return new URL(apiUrl).origin;
  } catch {
    return "";
  }
}

/**
 * The ingest origin out of a Sentry DSN.
 *
 * A DSN is a URL whose userinfo is the public key —
 * `https://<key>@o0.ingest.de.sentry.io/123` — and `URL.origin` drops that,
 * which is what makes this safe to put in a header: the CSP names the host, not
 * the key. Region-specific by nature (`.us.`, `.de.`), so this is derived from
 * the configured DSN rather than a wildcard guessed at.
 */
export function sentryOriginFrom(dsn: string): string {
  if (!dsn) return "";
  try {
    return new URL(dsn).origin;
  } catch {
    return "";
  }
}
