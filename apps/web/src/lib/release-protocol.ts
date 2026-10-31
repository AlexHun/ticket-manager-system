/**
 * The wire between the web server and an open tab about which release it runs
 * (#452): `release.ts` beside `vite.config.ts` serves it, `release-check.ts`
 * reads it.
 *
 * Import-free, for the reason `routes.ts` is: `vite.config.ts` reaches it by
 * relative path under Vite's native config loader.
 */

/** Where the server names its release, on the web origin rather than the API's. */
export const RELEASE_PATH = "/version.json";

/** What `RELEASE_PATH` answers. `release` is the server's `VITE_SENTRY_RELEASE`. */
export interface ReleaseFile {
  release: string;
}

/**
 * The release a `RELEASE_PATH` body names, or `null` for anything else.
 *
 * `null` rather than a throw: an SPA fallback answering with `index.html`, or a
 * proxy's error page, is a server that cannot say, not a new release.
 */
export function readRelease(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const release = (body as Partial<ReleaseFile>).release;
  return typeof release === "string" && release.length > 0 ? release : null;
}
