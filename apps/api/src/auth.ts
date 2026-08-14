import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin } from "better-auth/plugins";
import { prisma } from "./db";

const parsedOrigins = process.env.TRUSTED_ORIGINS?.split(",")
  .map((o) => o.trim())
  .filter(Boolean);

if (!parsedOrigins?.length) {
  throw new Error("TRUSTED_ORIGINS must be set (comma-separated list)");
}

export const trustedOrigins = parsedOrigins;

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
 *
 * Unset therefore falls back to `SameSite=None; Secure` in production, which is
 * what makes a Railway-domain deployment work at all. That is the weaker
 * setting and it is deliberate: the alternative is not a safer deployment, it
 * is a broken one. What still stands behind it is `trustedOrigins` — CORS will
 * not let an unlisted origin read a response, and Better Auth's own origin
 * check runs on top (both enabled here; only the test environment turns them
 * off, and only because the E2E ports make the browser call it cross-site).
 *
 * Local development needs none of this: web on :4000 and API on :3001 are the
 * same site, ports being irrelevant to that judgement.
 */
const cookieDomain = process.env.COOKIE_DOMAIN?.trim() || "";

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
  emailAndPassword: { enabled: true, disableSignUp: true },
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
    // Both of these are decided by `cookieDomain` above, and exactly one of
    // them applies at a time — see the note there for why.
    crossSubDomainCookies: cookieDomain
      ? { enabled: true, domain: cookieDomain }
      : undefined,
    defaultCookieAttributes:
      isProduction && !cookieDomain
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
      defaultRole: "agent",
      adminRoles: ["admin"],
    }),
  ],
});
