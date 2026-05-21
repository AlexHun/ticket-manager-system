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
