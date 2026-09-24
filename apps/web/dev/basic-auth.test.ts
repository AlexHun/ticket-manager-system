import { describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  BASIC_AUTH_ENV,
  basicAuthMiddleware,
  gateDecision,
  readCredentials,
  type Credentials,
} from "./basic-auth.ts";
import { REPO_ROOT, childEnv } from "./child-env.ts";

/**
 * The gate in front of the develop dev server.
 *
 * Almost everything is asked of the two pure halves — which credentials are in
 * force, and what one request earns — because that is where the rule lives. The
 * middleware gets three cases of its own for what no return value can show: the
 * challenge header on a 401, the credential being gone before the request
 * reaches the `/api` proxy, and `/health` answered with a query string on it.
 * The last case is `childEnv`, so a suite spawned from `/__dev/tests` never
 * inherits the password.
 */

const creds: Credentials = { username: "desk", password: "s3cret:with:colons" };

const basic = (user: string, pass: string) =>
  `Basic ${Buffer.from(`${user}:${pass}`, "utf8").toString("base64")}`;

describe("readCredentials", () => {
  it("is off when nothing is set, which is every local dev server", () => {
    expect(readCredentials({})).toBeNull();
  });

  it("returns both credentials when both are set", () => {
    expect(
      readCredentials({
        [BASIC_AUTH_ENV.required]: "1",
        [BASIC_AUTH_ENV.username]: "desk",
        [BASIC_AUTH_ENV.password]: "pw",
      }),
    ).toEqual({ username: "desk", password: "pw" });
  });

  it("gates a server that sets credentials without the flag", () => {
    expect(
      readCredentials({
        [BASIC_AUTH_ENV.username]: "desk",
        [BASIC_AUTH_ENV.password]: "pw",
      }),
    ).toEqual({ username: "desk", password: "pw" });
  });

  it.each([
    [
      "the password",
      { [BASIC_AUTH_ENV.username]: "desk" },
      BASIC_AUTH_ENV.password,
    ],
    [
      "the username",
      { [BASIC_AUTH_ENV.password]: "pw" },
      BASIC_AUTH_ENV.username,
    ],
    ["both", {}, BASIC_AUTH_ENV.username],
  ])(
    "refuses to start when the flag is on and %s is missing",
    (_what, set, named) => {
      expect(() =>
        readCredentials({ [BASIC_AUTH_ENV.required]: "1", ...set }),
      ).toThrow(named);
    },
  );

  it("treats an empty value as missing", () => {
    expect(() =>
      readCredentials({
        [BASIC_AUTH_ENV.required]: "1",
        [BASIC_AUTH_ENV.username]: "desk",
        [BASIC_AUTH_ENV.password]: "",
      }),
    ).toThrow(BASIC_AUTH_ENV.password);
  });

  it("refuses a half configuration even without the flag", () => {
    expect(() =>
      readCredentials({ [BASIC_AUTH_ENV.username]: "desk" }),
    ).toThrow(BASIC_AUTH_ENV.password);
  });
});

describe("gateDecision", () => {
  it("lets the healthcheck through without credentials", () => {
    expect(gateDecision("/health", undefined, creds)).toBe("health");
  });

  it("gates everything else without credentials, the API and /__dev included", () => {
    for (const path of [
      "/",
      "/api/health",
      "/__dev/map",
      "/__devtools/graph",
    ]) {
      expect(gateDecision(path, undefined, creds)).toBe("challenge");
    }
  });

  it("does not stretch the healthcheck exemption to its neighbours", () => {
    expect(gateDecision("/healthz", undefined, creds)).toBe("challenge");
    expect(gateDecision("/health/", undefined, creds)).toBe("challenge");
  });

  it("allows the right pair, a password with colons in it included", () => {
    expect(gateDecision("/", basic("desk", "s3cret:with:colons"), creds)).toBe(
      "allow",
    );
  });

  it.each([
    ["a wrong password", basic("desk", "nope")],
    ["a wrong username", basic("someone", "s3cret:with:colons")],
    ["an empty pair", basic("", "")],
    [
      "another scheme",
      `Bearer ${basic("desk", "s3cret:with:colons").slice(6)}`,
    ],
    ["no token", "Basic"],
    [
      "a token with no colon",
      `Basic ${Buffer.from("desk").toString("base64")}`,
    ],
  ])("challenges %s", (_what, header) => {
    expect(gateDecision("/", header, creds)).toBe("challenge");
  });
});

/** Just enough of a response to see what the middleware wrote. */
function fakeResponse() {
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: "",
    setHeader(name: string, value: string) {
      res.headers[name.toLowerCase()] = value;
    },
    end(body?: string) {
      res.body = body ?? "";
    },
  };
  return res;
}

function run(url: string, authorization?: string) {
  const req = {
    url,
    headers: authorization ? { authorization } : {},
  } as unknown as IncomingMessage;
  const res = fakeResponse();
  const next = vi.fn();
  basicAuthMiddleware(creds)(req, res as unknown as ServerResponse, next);
  return { req, res, next };
}

describe("basicAuthMiddleware", () => {
  it("answers 401 with a Basic challenge and does not call through", () => {
    const { res, next } = run("/api/health");
    expect(res.statusCode).toBe(401);
    expect(res.headers["www-authenticate"]).toMatch(/^Basic realm="/);
    expect(next).not.toHaveBeenCalled();
  });

  it("strips the credential before the request reaches the proxy", () => {
    const { req, next } = run(
      "/api/health",
      basic("desk", "s3cret:with:colons"),
    );
    expect(next).toHaveBeenCalledOnce();
    expect(req.headers.authorization).toBeUndefined();
  });

  it("answers the healthcheck itself, query string and all", () => {
    const { res, next } = run("/health?probe=1");
    expect(res.statusCode).toBe(200);
    expect(next).not.toHaveBeenCalled();
  });
});

describe("childEnv", () => {
  it("hands no suite the gate's credentials", () => {
    vi.stubEnv(BASIC_AUTH_ENV.required, "1");
    vi.stubEnv(BASIC_AUTH_ENV.username, "desk");
    vi.stubEnv(BASIC_AUTH_ENV.password, "pw");
    try {
      const env = childEnv(REPO_ROOT);
      for (const key of Object.values(BASIC_AUTH_ENV)) {
        expect(env[key]).toBeUndefined();
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
