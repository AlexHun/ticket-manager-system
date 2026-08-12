import * as Sentry from "@sentry/react";

/**
 * Sentry for the browser half, initialised from `main.tsx` before the app
 * renders.
 *
 * **No `VITE_SENTRY_DSN` means no Sentry**, same bargain the API makes. The DSN
 * is a build-time value baked into the bundle, which is fine — a DSN is public
 * by design, it only grants the ability to *send* events — but it does mean a
 * new DSN needs a rebuild, not just a redeploy. So does the CSP entry it
 * requires; see `cspDirectives` in `vite.config.ts`.
 *
 * ---
 *
 * ## What this deliberately does not collect
 *
 * The same reasoning as `apps/api/src/instrument.ts`, pointed at a different
 * surface. This app renders customer emails on screen and holds a Better Auth
 * session cookie:
 *
 * - **Session Replay is not enabled, and should not be.** It is the headline
 *   feature of the browser SDK and it films the DOM — which here means the ticket
 *   thread, in full, including whatever a stranger emailed in. Its masking
 *   options reduce that; they do not make it a thing to switch on casually.
 * - `httpBodies: []` — the axios calls this app makes carry ticket bodies and
 *   agent drafts in both directions, and a failed request is precisely when the
 *   SDK would want to attach one.
 * - Console breadcrumbs are off. They record the arguments to every
 *   `console.*` call, which is a channel nobody audits for what they pass it.
 * - `userInfo: false` — the signed-in agent is identifiable by their session
 *   without their email address being attached to every event.
 *
 * DOM and navigation breadcrumbs stay on. They record *which* element was
 * clicked and which route was entered, not what anything said, and they are most
 * of what makes a front-end stack trace reproducible.
 */
const dsn = import.meta.env.VITE_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,

    dataCollection: {
      userInfo: false,
      httpBodies: [],
      urlQueryParams: false,
    },

    integrations: [
      Sentry.breadcrumbsIntegration({
        console: false,
        dom: true,
        fetch: true,
        history: true,
        xhr: true,
      }),
    ],

    // Off unless asked for, and asked for with a number. Tracing every route
    // change buys little on an internal tool this size.
    tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? 0),

    /**
     * The same hard stop the API carries, for the same measured reason: on the
     * server the `dataCollection` deny list above it did not hold, and an
     * `authorization` header reached the wire anyway. This does not depend on
     * these options behaving as documented.
     */
    beforeSend(event) {
      const request = event.request;
      if (request) {
        delete request.data;
        delete request.cookies;
        delete request.query_string;
        delete request.headers;
      }
      return event;
    },
  });
}

export { Sentry };
