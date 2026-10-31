import type { Connect, Plugin } from "vite";
import { RELEASE_PATH, type ReleaseFile } from "./src/lib/release-protocol.ts";

/**
 * Names the server's release at `RELEASE_PATH`, so a tab left open across a
 * deploy can tell it is running the previous one (#452).
 *
 * Both servers need it. Production's Caddy serves `dist/` and its `@document`
 * matcher already sends everything outside `/assets` as `no-cache`, so a build
 * emits the file. The develop service runs the dev server, which has no `dist/`,
 * so the middleware below answers it there, with the value `vite.config.ts`
 * computed when that server started; behind `basicAuthPlugin`, being installed
 * after it.
 *
 * Vite's own client was meant to reload a stale develop tab when its HMR
 * socket closed, and on 2026-10-08 did not. Nothing here relies on that socket.
 */
export function releasePlugin(release: string): Plugin {
  const body = releaseBody(release);

  return {
    name: "ticket:release-file",
    configureServer(server) {
      server.middlewares.use(RELEASE_PATH, releaseMiddleware(release));
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: RELEASE_PATH.slice(1),
        source: body,
      });
    },
  };
}

/** The dev server's answer at `RELEASE_PATH`. */
export function releaseMiddleware(release: string): Connect.NextHandleFunction {
  const body = releaseBody(release);

  return (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(body);
  };
}

function releaseBody(release: string): string {
  return JSON.stringify({ release } satisfies ReleaseFile);
}

/**
 * The commit `releaseName()` in `vite.config.ts` stamps: git's short sha, or
 * where git cannot answer, Railway's `RAILWAY_GIT_COMMIT_SHA` cut to the same
 * length.
 *
 * The develop image has neither `.git` nor `git` (`Dockerfile.dev`), so without
 * the fallback its release was `web@<version>` alone. A merge's deploy carries
 * the version of the bump before it, so the tab the deploy before left open saw
 * no new release (#452). The dev server reads the variable at runtime, where
 * Railway sets it. A production build sees it only if `apps/web/Dockerfile`
 * passes it in as an `ARG`, which it does not today.
 */
export function deployedCommit(
  gitSha: string,
  env: Record<string, string | undefined>,
): string {
  return gitSha || (env.RAILWAY_GIT_COMMIT_SHA ?? "").slice(0, 7);
}
