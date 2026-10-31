import { queryOptions } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { RELEASE_PATH, readRelease } from "@/lib/release-protocol";

/**
 * The release the server runs now, as `release.ts` names it (#452), or `null`
 * when it cannot say.
 *
 * `baseURL: ""` because the file is the web server's, not the API's: the E2E
 * and a dev server pointed at another API set `VITE_API_URL`, and the shared
 * instance would send this there. No retry, since the next focus or interval
 * asks again.
 */
export function releaseQueryOptions() {
  return queryOptions({
    queryKey: ["release"],
    queryFn: async ({ signal }) => {
      const { data } = await api.get<unknown>(RELEASE_PATH, {
        baseURL: "",
        signal,
      });
      return readRelease(data);
    },
    retry: false,
  });
}

/**
 * Whether the server runs a release other than the one this tab loaded.
 *
 * A server that cannot say, or a bundle with no release stamped in it, never
 * counts as replaced: the tab then behaves as it did before #452.
 */
export function isReplaced(served: string | null | undefined): boolean {
  const running = import.meta.env.VITE_SENTRY_RELEASE;
  return Boolean(running) && Boolean(served) && served !== running;
}

/** The `sessionStorage` key holding the release this tab last reloaded for. */
const RELOADED_FOR_KEY = "reloaded-for-release";

/**
 * Reloads the page for `served`, unless this tab already reloaded for it.
 *
 * Once per release, so a crash the new release has too stays on its error
 * screen instead of reloading forever. Storage that cannot be read or written
 * (a locked-down browser) means no reload, for the same reason.
 */
export function reloadOnceFor(served: string): void {
  try {
    if (sessionStorage.getItem(RELOADED_FOR_KEY) === served) return;
    sessionStorage.setItem(RELOADED_FOR_KEY, served);
  } catch {
    return;
  }
  window.location.reload();
}
