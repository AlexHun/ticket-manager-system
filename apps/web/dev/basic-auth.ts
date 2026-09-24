/**
 * HTTP Basic Auth over the whole dev server, for the Railway `develop` service.
 *
 * That service runs `vite dev` rather than a static build (see
 * `apps/web/Dockerfile.dev`), which is what makes `/__dev` reachable there — and
 * `/__dev/tests` spawns suites on a machine somebody pays for. The repo is
 * public, so serving source is not the concern; a stranger starting test runs
 * is. So every request is gated: the app, `/__dev*`, and `/api/*` too, which
 * this reaches because a pre-middleware installed from `configureServer` runs
 * ahead of Vite's proxy (Vite 8.2: host check → plugin middlewares → transform
 * → proxy). The HMR websocket is not a connect request and is not gated here;
 * Vite's own websocket token guards it, and that token only reaches a browser
 * inside the client module this gate serves.
 *
 * `/health` is the one exemption, for Railway's healthcheck. Its host,
 * `healthcheck.railway.app`, has to be in `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS`
 * as well: host validation runs before this middleware and would 403 it first.
 *
 * The comparison matches the inbound-email webhook's (`checkBasicAuth` in
 * `apps/api/src/routes/webhooks/inbound-email.ts`): hash both sides so the
 * buffers are equal length, then `timingSafeEqual`.
 *
 * `apply: "serve"`, so a production build never loads it. Locally it is a no-op
 * unless credentials are set; see `readCredentials` for when it refuses to start.
 */

import type { Connect, Plugin } from "vite";
import { createHash, timingSafeEqual } from "node:crypto";

export const BASIC_AUTH_ENV = {
  /** Set by `Dockerfile.dev`, so a deploy missing a credential fails closed. */
  required: "DEV_BASIC_AUTH_REQUIRED",
  username: "DEV_BASIC_AUTH_USERNAME",
  password: "DEV_BASIC_AUTH_PASSWORD",
} as const;

export interface Credentials {
  username: string;
  password: string;
}

/**
 * The credentials in force, or `null` when the gate is off.
 *
 * Off only when nothing at all is set, which is every developer's machine.
 * Anything else is a request for the gate, so a missing half **throws** rather
 * than serving an open dev server: the flag the dev image sets, or one
 * credential without the other.
 */
export function readCredentials(
  env: Record<string, string | undefined>,
): Credentials | null {
  const username = env[BASIC_AUTH_ENV.username] ?? "";
  const password = env[BASIC_AUTH_ENV.password] ?? "";
  const required = (env[BASIC_AUTH_ENV.required] ?? "") !== "";

  if (!required && username === "" && password === "") return null;

  const missing = [
    username === "" && BASIC_AUTH_ENV.username,
    password === "" && BASIC_AUTH_ENV.password,
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(
      `Basic auth is required on this dev server but ${missing.join(" and ")} ` +
        `${missing.length === 1 ? "is" : "are"} not set. Refusing to start ` +
        "without it rather than serving /__dev to anyone.",
    );
  }
  return { username, password };
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export type Decision = "health" | "allow" | "challenge";

/** What one request earns, from its path and its `Authorization` header. */
export function decide(
  pathname: string,
  authorization: string | undefined,
  expected: Credentials,
): Decision {
  if (pathname === "/health") return "health";

  const [scheme, token] = (authorization ?? "").split(" ");
  if (scheme !== "Basic" || !token) return "challenge";

  const decoded = Buffer.from(token, "base64").toString("utf8");
  const sep = decoded.indexOf(":");
  if (sep === -1) return "challenge";
  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);

  // Both compared every time, so a right username with a wrong password takes
  // as long as a wrong username.
  const userOk = timingSafeEqual(sha256(user), sha256(expected.username));
  const passOk = timingSafeEqual(sha256(pass), sha256(expected.password));
  return userOk && passOk ? "allow" : "challenge";
}

export function basicAuthMiddleware(
  expected: Credentials,
): Connect.NextHandleFunction {
  return (req, res, next) => {
    const { pathname } = new URL(req.url ?? "/", "http://dev.invalid");
    const decision = decide(pathname, req.headers.authorization, expected);

    if (decision === "health") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("OK");
      return;
    }
    if (decision === "challenge") {
      res.statusCode = 401;
      res.setHeader(
        "WWW-Authenticate",
        'Basic realm="ticket-manager develop", charset="UTF-8"',
      );
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Authentication required");
      return;
    }
    // The API behind the proxy has no use for this credential and should never
    // see it — nor log it.
    delete req.headers.authorization;
    next();
  };
}

export function basicAuthPlugin(
  env: Record<string, string | undefined> = process.env,
): Plugin {
  return {
    name: "ticket-basic-auth",
    apply: "serve",
    // Ahead of every other plugin's middlewares, not only the dev tools'.
    enforce: "pre",
    configureServer(server) {
      // Throwing here fails `createServer`, so a misconfigured deploy never
      // starts listening and Railway's healthcheck fails the release.
      const credentials = readCredentials(env);
      if (credentials) server.middlewares.use(basicAuthMiddleware(credentials));
    },
  };
}
