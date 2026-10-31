import { act, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { apiStub } from "@/test/api-stub";
import { renderRoutes } from "@/test/render";
import type { QueryClient } from "@tanstack/react-query";
import { RELEASE_PATH } from "@/lib/release-protocol";
import {
  RELEASE_CHECK_INTERVAL_MS,
  releaseQueryOptions,
} from "@/lib/release-check";
import { NEW_RELEASE_TOAST, NewReleaseToast } from "./NewReleaseToast";

vi.mock("@/lib/api", () => import("@/test/api-stub"));

const RUNNING = "web@0.1.300+aaaaaaa";
const DEPLOYED = "web@0.1.301+bbbbbbb";

function renderToast() {
  return renderRoutes([{ path: "/", element: <NewReleaseToast /> }]);
}

/**
 * How many answers the release query has settled on, failures included: a
 * request counted is not yet a request answered, so an absence is asserted
 * only once the answer it is about has landed.
 */
function answers(client: QueryClient): number {
  const state = client.getQueryState(releaseQueryOptions().queryKey);
  return (state?.dataUpdateCount ?? 0) + (state?.errorUpdateCount ?? 0);
}

/**
 * What react-query's focus manager listens for when a tab comes back — on
 * `window`, not `document` (query-core's `focusManager.js`).
 */
async function refocus() {
  await act(async () => {
    window.dispatchEvent(new Event("visibilitychange"));
  });
}

let releaseGet: ReturnType<typeof apiStub.get>;

beforeEach(() => {
  // `setup.ts` mocks sonner once for the whole file and clears nothing.
  vi.mocked(toast.info).mockClear();
  apiStub.reset();
  releaseGet = apiStub.get(RELEASE_PATH);
  vi.stubEnv("VITE_SENTRY_RELEASE", RUNNING);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("NewReleaseToast", () => {
  test("offers a reload once the server runs another release", async () => {
    releaseGet.mockResolvedValue({ data: { release: DEPLOYED } });
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    renderToast();

    await waitFor(() => expect(toast.info).toHaveBeenCalledTimes(1));
    const [title, options] = vi.mocked(toast.info).mock.calls[0] as [
      string,
      {
        description: string;
        duration: number;
        action: { label: string; onClick: () => void };
      },
    ];
    expect(title).toBe(NEW_RELEASE_TOAST.title);
    expect(options.description).toBe(NEW_RELEASE_TOAST.description);
    expect(options.duration).toBe(Infinity);
    expect(options.action.label).toBe(NEW_RELEASE_TOAST.action);

    options.action.onClick();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test("asks the web origin, not the API's", async () => {
    releaseGet.mockResolvedValue({ data: { release: RUNNING } });
    renderToast();

    await waitFor(() => expect(releaseGet).toHaveBeenCalled());
    const [, config] = releaseGet.mock.calls[0] as [
      string,
      { baseURL: string },
    ];
    expect(config.baseURL).toBe("");
  });

  test("says nothing while the server runs this tab's release", async () => {
    releaseGet.mockResolvedValue({ data: { release: RUNNING } });
    const { queryClient } = renderToast();

    await waitFor(() => expect(answers(queryClient)).toBe(1));
    await refocus();
    await waitFor(() => expect(answers(queryClient)).toBe(2));
    expect(toast.info).not.toHaveBeenCalled();
  });

  test("says nothing when the bundle carries no release to compare", async () => {
    vi.stubEnv("VITE_SENTRY_RELEASE", "");
    releaseGet.mockResolvedValue({ data: { release: DEPLOYED } });
    const { queryClient } = renderToast();

    await waitFor(() =>
      expect(queryClient.getQueryData(releaseQueryOptions().queryKey)).toBe(
        DEPLOYED,
      ),
    );
    expect(toast.info).not.toHaveBeenCalled();
  });

  test.each([
    ["is unreachable", () => Promise.reject(new Error("Network Error"))],
    ["answers with the SPA's HTML", () => ({ data: "<!doctype html>" })],
  ])("says nothing when the server %s", async (_name, respond) => {
    releaseGet.mockImplementation(respond);
    const { queryClient } = renderToast();

    await waitFor(() => expect(answers(queryClient)).toBe(1));
    await refocus();
    await waitFor(() => expect(answers(queryClient)).toBe(2));
    expect(toast.info).not.toHaveBeenCalled();
  });

  test("notices a deploy when the tab comes back, and tells it once", async () => {
    releaseGet.mockResolvedValue({ data: { release: RUNNING } });
    const { queryClient } = renderToast();
    await waitFor(() => expect(answers(queryClient)).toBe(1));

    releaseGet.mockResolvedValue({ data: { release: DEPLOYED } });
    await refocus();
    await waitFor(() => expect(toast.info).toHaveBeenCalledTimes(1));

    // A blip between two answers naming the same deploy: the query's data
    // changes twice, so only the component's own memory keeps a dismissed
    // toast dismissed.
    releaseGet.mockResolvedValue({ data: "<!doctype html>" });
    await refocus();
    await waitFor(() => expect(answers(queryClient)).toBe(3));
    releaseGet.mockResolvedValue({ data: { release: DEPLOYED } });
    await refocus();
    await waitFor(() => expect(answers(queryClient)).toBe(4));
    expect(toast.info).toHaveBeenCalledTimes(1);
  });

  test("checks again on its own while the tab stays open", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      releaseGet.mockResolvedValue({ data: { release: RUNNING } });
      renderToast();
      await waitFor(() => expect(releaseGet).toHaveBeenCalledTimes(1));

      releaseGet.mockResolvedValue({ data: { release: DEPLOYED } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(RELEASE_CHECK_INTERVAL_MS);
      });
      await waitFor(() => expect(toast.info).toHaveBeenCalledTimes(1));
    } finally {
      vi.useRealTimers();
    }
  });
});
