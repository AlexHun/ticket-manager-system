import * as Sentry from "@sentry/bun";

/**
 * Sentry, initialised before anything else in the process — `index.ts` imports
 * this first so the SDK's auto-instrumentation is in place before Express,
 * Prisma or pg-boss are loaded.
 *
 * **No `SENTRY_DSN` means no Sentry**, and nothing else in the app changes. Same
 * bargain `OPENAI_API_KEY` makes: an optional integration may not become a boot
 * requirement, and a developer who has never heard of Sentry must be able to run
 * this repo.
 *
 * ---
 *
 * ## What is switched off, and why it is not paranoia
 *
 * This application's primary data is **email written by strangers**, and its
 * secondary data is **prompts built from that email**. Sentry's defaults are
 * written for an average web app and are wrong here in six specific ways —
 * every one of them would ship customer content to a third party the first time
 * a route threw. They are listed rather than summarised so that anyone loosening
 * one has to say which:
 *
 * - `httpBodies` defaults to collecting **every** request body. The body of
 *   `POST /api/webhooks/inbound-email` *is* a customer's email — subject, full
 *   text, and the `htmlBody` that `MESSAGE_SELECT` is careful never to serve.
 *   One failing insert would put it in an issue tracker. Set to `[]`.
 * - `genAI.inputs`/`outputs` default to true, and the AI integrations record
 *   prompts. Every prompt in `ai/` is built from that same customer text, and
 *   the knowledge-base corpus — including the `> Internal:` notes that
 *   `knowledge-base.ts` strips precisely so the model never sees them — passes
 *   through the same calls. Both false.
 * - `cookies` defaults to true. These are Better Auth session cookies; a
 *   captured one is a live session for whoever reads the issue.
 * - `httpHeaders` defaults to true both ways. The inbound webhook authenticates
 *   with HTTP Basic, so its `Authorization` header is the shared secret in
 *   plaintext. Denied by name rather than wholesale — a `content-type` is
 *   genuinely useful when debugging a provider's payload.
 * - `databaseQueryData` defaults to true, which attaches query parameters. The
 *   parameters here are message bodies and customer addresses.
 * - `stackFrameVariables` defaults to true. A throw anywhere in the ingestion or
 *   AI path has `textBody`, the assembled prompt, or the webhook credentials
 *   sitting in a local. This is the one that leaks what the five above protect.
 *
 * What is left is what an error report is actually for: the exception, the
 * stack, the route, the release, the environment.
 */
/**
 * The only request headers allowed out of this process.
 *
 * `content-type` earns its place: telling a provider's `multipart/form-data`
 * from its JSON is most of what debugging an ingestion failure consists of.
 * Nothing here identifies a person or authorises anything.
 */
const SAFE_REQUEST_HEADERS = new Set([
  "content-type",
  "content-length",
  "user-agent",
  "host",
]);

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",

    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: {
        request: { deny: ["authorization", "cookie", "proxy-authorization"] },
        response: { deny: ["set-cookie"] },
      },
      httpBodies: [],
      urlQueryParams: false,
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      stackFrameVariables: false,
    },

    // Off by default. Tracing on this process would sample the AI calls and the
    // queue, and the interesting spans there are the ones carrying prompts.
    // Turn it on deliberately, with a number, once there is a question tracing
    // would answer.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),

    /**
     * Last line before an event leaves the process, and **not** belt-and-braces
     * — it is load-bearing, because the block above was measured and found
     * insufficient.
     *
     * With `httpHeaders.request: { deny: ["authorization", …] }` set exactly as
     * it is above, a forced 500 on the inbound webhook still produced an event
     * carrying `request.headers.authorization: "Basic ZGV2…"` — the webhook's
     * shared secret, base64 of a username and password, in an issue tracker.
     * Whatever the reason (SDK 10.70), the lesson is the one this repo keeps
     * relearning about declarative safety settings: verify, then keep the
     * check that does not depend on the setting.
     *
     * So headers are filtered by **allowlist**. A deny list has to anticipate
     * every sensitive header, and it silently fails open on the one nobody
     * thought of; an allowlist fails closed on everything, and the four kept
     * below are the ones that were actually useful while debugging provider
     * payloads. Bodies, cookies and query strings are deleted outright.
     */
    beforeSend(event) {
      const request = event.request;
      if (request) {
        delete request.data;
        delete request.cookies;
        delete request.query_string;
        if (request.headers) {
          request.headers = Object.fromEntries(
            Object.entries(request.headers).filter(([name]) =>
              SAFE_REQUEST_HEADERS.has(name.toLowerCase()),
            ),
          );
        }
      }
      return event;
    },
  });
}

export { Sentry };
