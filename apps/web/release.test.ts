import { describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { deployedCommit, releaseMiddleware, releasePlugin } from "./release.ts";
import { RELEASE_PATH, readRelease } from "./src/lib/release-protocol.ts";

/**
 * The server half of #452: what names the running release to an open tab.
 *
 * The build half is asked through the plugin's own `generateBundle` hook with a
 * stand-in `emitFile`, and the dev half through the middleware it installs,
 * since those are the two places the file comes from; a real build or server
 * would add minutes and test Vite rather than this.
 */

const RELEASE = "web@0.1.300+abc1234";

function serve(method: string) {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: "",
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
    },
    end(body?: string) {
      this.body = body ?? "";
    },
  };
  const next = vi.fn();
  releaseMiddleware(RELEASE)(
    { method } as IncomingMessage,
    res as unknown as ServerResponse,
    next,
  );
  return { res, next };
}

describe("releasePlugin on a build", () => {
  it("emits the release file at the path the tab asks for", () => {
    const emitFile = vi.fn();
    const hook = releasePlugin(RELEASE).generateBundle;
    const handler = typeof hook === "function" ? hook : hook?.handler;
    // The hook reads nothing but `emitFile` off its context.
    (handler as (this: unknown) => void).call({ emitFile });

    expect(emitFile).toHaveBeenCalledTimes(1);
    const [asset] = emitFile.mock.calls[0] as [
      { type: string; fileName: string; source: string },
    ];
    expect(asset.type).toBe("asset");
    expect(`/${asset.fileName}`).toBe(RELEASE_PATH);
    expect(readRelease(JSON.parse(asset.source))).toBe(RELEASE);
  });
});

describe("releaseMiddleware on the dev server", () => {
  it("answers a GET with the release, never cached", () => {
    const { res, next } = serve("GET");

    expect(next).not.toHaveBeenCalled();
    expect(res.headers["content-type"]).toBe("application/json");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(readRelease(JSON.parse(res.body))).toBe(RELEASE);
  });

  it("answers a HEAD too", () => {
    const { res, next } = serve("HEAD");

    expect(next).not.toHaveBeenCalled();
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("passes anything but a GET or HEAD on", () => {
    const { res, next } = serve("POST");

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.body).toBe("");
  });
});

describe("deployedCommit", () => {
  it("takes git's answer when there is one", () => {
    expect(
      deployedCommit("abc1234", { RAILWAY_GIT_COMMIT_SHA: "fedcba9876543210" }),
    ).toBe("abc1234");
  });

  it("falls back to Railway's commit, shortened, where the image has no git", () => {
    expect(
      deployedCommit("", { RAILWAY_GIT_COMMIT_SHA: "fedcba9876543210" }),
    ).toBe("fedcba9");
  });

  it("names no commit when neither knows one", () => {
    expect(deployedCommit("", {})).toBe("");
  });
});

describe("readRelease", () => {
  it.each([
    ["an HTML fallback", "<!doctype html>"],
    ["null", null],
    ["an empty release", { release: "" }],
    ["a non-string release", { release: 7 }],
    ["no release", {}],
  ])("names no release for %s", (_name, body) => {
    expect(readRelease(body)).toBeNull();
  });
});
