import * as Sentry from "@sentry/bun";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin } from "better-auth/plugins";
import { USER_ROLE } from "@ticket/shared";
// A leaf module rather than a constant declared here, and the note on it says
// why: this file cannot be loaded by a unit test, so anything else that needs
// the number cannot reach it through this file.
import { RESET_TOKEN_TTL_SECONDS } from "./auth-tokens";
import { prisma } from "./db";
import { enqueueEmail } from "./jobs/send-email";

const parsedOrigins = process.env.TRUSTED_ORIGINS?.split(",")
  .map((o) => o.trim())
  .filter(Boolean);

if (!parsedOrigins?.length) {
  throw new Error("TRUSTED_ORIGINS must be set (comma-separated list)");
}

export const trustedOrigins = parsedOrigins;

/**
 * Where the browser-facing app lives, for links this process puts in an email.
 *
 * The first trusted origin, because that is what the list is: the origins the
 * app is served from. A reset link has to land on a *page*, and this process
 * serves JSON — pointing it at `BETTER_AUTH_URL` would work behind the
 * same-origin proxy and send people to the API's own domain everywhere else.
 *
 * Only ever used to build a `redirectTo`, which Better Auth then checks against
 * this same list before honouring it, so a bad value here fails closed.
 */
export const appOrigin = parsedOrigins[0] as string;

if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32) {
  throw new Error(
    "BETTER_AUTH_SECRET must be set and at least 32 characters (generate with: openssl rand -base64 32)",
  );
}

const isProduction = process.env.NODE_ENV === "production";
const isTest = process.env.NODE_ENV === "test";

/**
 * The parent domain the session cookie is scoped to, or empty.
 *
 * This exists because "same site" is decided by the *registrable* domain, and
 * the two deployments this app supports land on opposite sides of that line:
 *
 * - **A shared parent domain** (`app.example.com` calling `api.example.com`)
 *   is same-site. Set this to `.example.com` and the cookie is issued for the
 *   parent, so `SameSite=Lax` — the strong default — keeps working.
 * - **Railway's generated domains** are not. `up.railway.app` is on the Public
 *   Suffix List, so `web-x.up.railway.app` and `api-x.up.railway.app` are
 *   different sites, no cookie may be scoped to their shared suffix, and a
 *   `Lax` cookie is simply never sent on the app's XHR. The symptom is a login
 *   that returns 200 and leaves the user signed out.
 * - **One origin** — the web service proxying `/api/*` to the API service
 *   (`apps/web/Caddyfile`) — does not have the question. The cookie is
 *   first-party, so leave this empty and `sameOriginApi` below keeps `Lax`.
 *   This is the arrangement to prefer on Railway's own domains, because it is
 *   the only one of the three that needs no domain you own.
 *
 * Unset therefore falls back to `SameSite=None; Secure` in production, which is
 * what makes a Railway-domain deployment work at all. That is the weaker
 * setting and it is deliberate: the alternative is not a safer deployment, it
 * is a broken one. What still stands behind it is `trustedOrigins` — CORS will
 * not let an unlisted origin read a response, and Better Auth's own origin
 * check runs on top (both enabled here; only the test environment turns them
 * off, and only because the E2E ports make the browser call it cross-site).
 *
 * It is not, however, weak-but-fine: `SameSite=None` is a **third-party**
 * cookie, and Chrome incognito and Safari refuse those by default. That is not
 * a hardening problem, it is a locked-out user — sign-in answers 200 and the
 * session never arrives. Measured on the Railway deployment; the only per-user
 * workaround is to allow third-party cookies for the site. So the third
 * topology below is the one to prefer, and this fallback is what a deployment
 * that has not moved to it yet still runs on.
 *
 * Local development needs none of this: web on :4000 and API on :3001 are the
 * same site, ports being irrelevant to that judgement.
 */
const cookieDomain = process.env.COOKIE_DOMAIN?.trim() || "";

/**
 * True when the browser reaches this API on the same origin as the app itself —
 * the reverse-proxy topology in `apps/web/Caddyfile`, where the web service
 * answers `/api/*` and `VITE_API_URL` is empty.
 *
 * Then the session cookie is **first-party** and needs none of the machinery
 * above: `SameSite=Lax` works, which is the setting the whole `COOKIE_DOMAIN`
 * note is about wanting back. Without this the proxy would fix the *symptom*
 * (third-party cookie blocking) and keep the weaker attribute that only existed
 * to survive it.
 *
 * The test is the definition rather than a guess at one: `BETTER_AUTH_URL` is
 * this API's own public origin, so if that origin is *also* one the app is
 * served from, the two are the same origin. Unset — Better Auth infers the
 * origin per request — reads as false, so the fallback below stays, which is
 * the safe direction: `None` works first-party too, it is merely weaker. A
 * deployment that gets this wrong therefore still logs in.
 */
const sameOriginApi = (() => {
  const baseUrl = process.env.BETTER_AUTH_URL?.trim();
  if (!baseUrl) return false;
  // Both sides through `URL` rather than compared as strings: a trailing slash
  // on one of them is a configuration typo, not a different origin.
  const originOf = (value: string) => {
    try {
      return new URL(value).origin;
    } catch {
      return "";
    }
  };
  const base = originOf(baseUrl);
  return base !== "" && trustedOrigins.some((o) => originOf(o) === base);
})();

/**
 * A `COOKIE_DOMAIN` no trusted origin sits under is a cookie no browser will
 * store, and the failure is invisible from the server: every request simply
 * arrives without a session. Caught at boot instead, next to the other two
 * environment checks in this file, because a typo here costs an afternoon.
 */
if (cookieDomain) {
  const suffix = cookieDomain.startsWith(".") ? cookieDomain : `.${cookieDomain}`;
  const covered = trustedOrigins.some((origin) => {
    try {
      const { hostname } = new URL(origin);
      return hostname === suffix.slice(1) || hostname.endsWith(suffix);
    } catch {
      return false;
    }
  });

  if (!covered) {
    throw new Error(
      `COOKIE_DOMAIN (${cookieDomain}) does not cover any host in TRUSTED_ORIGINS (${trustedOrigins.join(", ")}) — the session cookie would be rejected by the browser`,
    );
  }
}

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  trustedOrigins,
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    resetPasswordTokenExpiresIn: RESET_TOKEN_TTL_SECONDS,
    /**
     * Where a reset link is written, for both flows that produce one.
     *
     * **This is the only place either flow touches mail**, and it does not send
     * anything: it writes an `OutboundEmail` row and lets `jobs/send-email.ts`
     * deal with providers. On a deployment with no provider — which is every
     * deployment today — the row is marked `undeliverable` and an admin reads
     * the link out of the outbox. That is not a degraded mode standing in for
     * the real one; it is how this app is meant to work until Postmark is bound,
     * and it is what makes removing admin-typed passwords survivable.
     *
     * **Which of the two flows this is, is derived rather than signalled.** An
     * invited colleague has no `credential` account row yet, because
     * `POST /api/users` creates them without a password on purpose; somebody who
     * has forgotten theirs has one. So the account row answers the question, and
     * no caller has to remember to say. It also stays right in the awkward case:
     * an invited user who never accepted and then uses "forgot password" is
     * still being invited, and still gets told so.
     */
    sendResetPassword: async ({ user, url }) => {
      // Not awaited, on Better Auth's own advice: this callback runs only for
      // an address that exists, so the time it takes is a signal about whether
      // it exists. The work behind it is a local INSERT either way, but the
      // account lookup below is a second query and the margin is not worth
      // handing out. Failures still surface — they just surface to us.
      void (async () => {
        /**
         * Two accounts that must never receive one of these, checked here
         * because this is the one place every door leads to.
         *
         * **The assistant.** `/request-password-reset` is public — that is what
         * makes a forgot-password form possible — so anyone may type any address
         * into it, the assistant's included. Left alone, that would mint a link
         * which sets a password on an account that deliberately has none, and
         * `resetPassword` creates the missing credential row exactly as
         * `setUserPassword` would. The result is a signable-in assistant: the
         * precise thing `rejectAssistant` in `routes/users.ts` exists to prevent,
         * reached by a route that never touches `routes/users.ts` at all. This
         * feature opened that door and closes it in the same breath.
         *
         * **A deleted colleague.** `deletedAt` is set on accounts that are gone;
         * mailing one an invitation would be inviting them back.
         */
        const account = await prisma.user.findUnique({
          where: { id: user.id },
          select: { automated: true, deletedAt: true },
        });
        if (!account || account.automated || account.deletedAt !== null) return;

        const credential = await prisma.account.findFirst({
          where: { userId: user.id, providerId: "credential" },
          select: { id: true },
        });
        const invited = credential === null;

        await enqueueEmail({
          kind: invited ? "invitation" : "passwordReset",
          toEmail: user.email,
          toName: user.name,
          subject: invited
            ? "You have been given a support desk account"
            : "Reset your support desk password",
          textBody: invited
            ? [
                `Hello ${user.name},`,
                "",
                "An account has been created for you on the support desk. Choose a password to finish setting it up:",
                "",
                url,
                "",
                "The link is good for 24 hours. If it has expired, ask an admin to send you another.",
                "",
                "Best regards,",
                "The Support Team",
              ].join("\n")
            : [
                `Hello ${user.name},`,
                "",
                "Someone asked to reset the password on your support desk account. Choose a new one here:",
                "",
                url,
                "",
                "The link is good for 24 hours. If this was not you, no action is needed — your current password still works.",
                "",
                "Best regards,",
                "The Support Team",
              ].join("\n"),
        });
      })().catch((err) => {
        // The token exists whatever happens here, so a failure is a person who
        // asked for a link and will never see one, with nothing on screen to say
        // so. Nowhere else would report it.
        console.error("[auth] failed to enqueue a reset email:", err);
        Sentry.captureException(err, { tags: { component: "auth-mail" } });
      });
    },
  },
  /**
   * Session data is carried in a short-lived signed cookie, so the common case
   * costs no database work at all.
   *
   * Without this, `requireAuth`/`requireAdmin` call `getSession` on *every*
   * request, and each call reads the session row and then the user row — two
   * round trips in front of every endpoint, including ones whose own query is
   * a single indexed lookup.
   *
   * The cost: this cache is what `DELETE /api/users/:id` has to outlive.
   * That route deletes the user's sessions specifically to force an immediate
   * sign-out (see `routes/users.ts`), and a request served from the cookie
   * never looks at the sessions table — so a just-deleted user keeps working
   * until their cookie expires. `maxAge` is the length of that window; 60s is
   * chosen to keep it short enough to be an inconvenience rather than a hole.
   * Raising it lengthens the window — don't, without revisiting that route.
   */
  session: {
    cookieCache: { enabled: true, maxAge: 60 },
  },
  rateLimit: {
    enabled: isProduction,
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
    },
  },
  advanced: {
    // Test-only: web (4001) and API (3002) are on different ports, so the
    // browser sends Sec-Fetch-Site: cross-site and Better Auth's origin check
    // 403s the request before CORS can answer. CORS still gates the request.
    disableOriginCheck: isTest,
    disableCSRFCheck: isTest,
    // Three topologies, at most one of these set. A shared parent domain gets
    // the first; cross-site Railway domains get the second; same-origin (the
    // proxy, and all of local dev) needs neither and keeps `SameSite=Lax`. See
    // the notes on `cookieDomain` and `sameOriginApi` above.
    crossSubDomainCookies: cookieDomain
      ? { enabled: true, domain: cookieDomain }
      : undefined,
    defaultCookieAttributes:
      isProduction && !cookieDomain && !sameOriginApi
        ? { sameSite: "none" as const, secure: true }
        : undefined,
    // Railway (and any other platform proxy) terminates TLS and forwards, so
    // the socket's peer address is the edge, not the caller. Left at its
    // default every request would look like it came from one IP, and the
    // 5-per-minute rule on `/sign-in/email` above would become a global budget
    // that any one visitor could exhaust for everybody.
    ipAddress: {
      ipAddressHeaders: ["x-forwarded-for"],
    },
  },
  plugins: [
    admin({
      defaultRole: USER_ROLE.agent,
      adminRoles: [USER_ROLE.admin],
    }),
  ],
});
