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
 * A server that cannot say, or a bundle with no release stamped in it, is
 * never a new release: a false "reload" costs a reload, and a missed one costs
 * what a reload already fixed before this existed.
 */
export function isReplaced(served: string | null | undefined): boolean {
  const running = import.meta.env.VITE_SENTRY_RELEASE;
  return Boolean(running) && Boolean(served) && served !== running;
}
