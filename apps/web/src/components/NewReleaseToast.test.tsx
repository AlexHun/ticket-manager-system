import { act, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { apiStub } from "@/test/api-stub";
import { renderRoutes } from "@/test/render";
import { RELEASE_PATH } from "@/lib/release-protocol";
import { NEW_RELEASE_TOAST, NewReleaseToast } from "./NewReleaseToast";

vi.mock("@/lib/api", () => import("@/test/api-stub"));

const RUNNING = "web@0.1.300+aaaaaaa";
const DEPLOYED = "web@0.1.301+bbbbbbb";

function renderToast() {
  return renderRoutes([{ path: "/", element: <NewReleaseToast /> }]);
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
    renderToast();

    await waitFor(() => expect(releaseGet).toHaveBeenCalledTimes(1));
    await refocus();
    await waitFor(() => expect(releaseGet).toHaveBeenCalledTimes(2));
    expect(toast.info).not.toHaveBeenCalled();
  });

  test.each([
    ["is unreachable", () => Promise.reject(new Error("Network Error"))],
    ["answers with the SPA's HTML", () => ({ data: "<!doctype html>" })],
  ])("says nothing when the server %s", async (_name, respond) => {
    releaseGet.mockImplementation(respond);
    renderToast();

    await waitFor(() => expect(releaseGet).toHaveBeenCalledTimes(1));
    await refocus();
    await waitFor(() => expect(releaseGet).toHaveBeenCalledTimes(2));
    expect(toast.info).not.toHaveBeenCalled();
  });

  test("notices a deploy when the tab comes back, and tells it once", async () => {
    releaseGet.mockResolvedValue({ data: { release: RUNNING } });
    renderToast();
    await waitFor(() => expect(releaseGet).toHaveBeenCalledTimes(1));

    releaseGet.mockResolvedValue({ data: { release: DEPLOYED } });
    await refocus();
    await waitFor(() => expect(toast.info).toHaveBeenCalledTimes(1));

    // A blip between two answers naming the same deploy: the query's data
    // changes twice, so only the component's own memory keeps a dismissed
    // toast dismissed.
    releaseGet.mockResolvedValue({ data: "<!doctype html>" });
    await refocus();
    await waitFor(() => expect(releaseGet).toHaveBeenCalledTimes(3));
    releaseGet.mockResolvedValue({ data: { release: DEPLOYED } });
    await refocus();
    await waitFor(() => expect(releaseGet).toHaveBeenCalledTimes(4));
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
        await vi.advanceTimersByTimeAsync(NEW_RELEASE_TOAST.intervalMs);
      });
      await waitFor(() => expect(toast.info).toHaveBeenCalledTimes(1));
    } finally {
      vi.useRealTimers();
    }
  });
});
