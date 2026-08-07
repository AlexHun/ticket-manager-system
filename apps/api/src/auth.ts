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
  },
  plugins: [
    admin({
      defaultRole: "agent",
      adminRoles: ["admin"],
    }),
  ],
});
