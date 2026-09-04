import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  DASHBOARD_RANGE,
  DASHBOARD_SCOPE,
  DEFAULT_DASHBOARD_RANGE,
} from "@ticket/shared";
import { ticketKeys } from "@/lib/ticket-queries";
import { apiStub } from "@/test/api-stub";
import { runLoader } from "@/test/run-loader";
import { dashboardLoader } from "./DashboardPage.loader";

/**
 * What `/` prefetches: three requests, and which params each of them carries.
 * That they go out together and survive one another's failures is
 * `prefetchLoader`'s doing, and is tested in `@/lib/route-prefetch.test.tsx`.
 */

vi.mock("@/lib/api", () => import("@/test/api-stub"));

const statsGet = apiStub.get("/api/tickets/stats");
const effectivenessGet = apiStub.get("/api/tickets/effectiveness");
const layoutGet = apiStub.get("/api/dashboard-layout");

/** Keeps what the loader primed — the suite's client sets `gcTime: 0`. */
function cacheKeepingClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
}

function paramsOf(call: unknown[] | undefined): unknown {
  return (call?.[1] as { params?: unknown } | undefined)?.params;
}

beforeEach(() => {
  apiStub.reset();
  statsGet.mockResolvedValue({ data: {} });
  effectivenessGet.mockResolvedValue({ data: {} });
  layoutGet.mockResolvedValue({ data: { layout: [], isDefault: true } });
});

describe("dashboardLoader", () => {
  test("starts all three of the dashboard's requests", async () => {
    await runLoader(dashboardLoader, "/");

    expect(statsGet).toHaveBeenCalledTimes(1);
    expect(effectivenessGet).toHaveBeenCalledTimes(1);
    expect(layoutGet).toHaveBeenCalledTimes(1);
  });

  test("scopes the stats to the URL and the effectiveness panel to the range alone", async () => {
    const { queryClient } = await runLoader(
      dashboardLoader,
      `/?range=${DASHBOARD_RANGE.d7}&scope=${DASHBOARD_SCOPE.mine}`,
      { queryClient: cacheKeepingClient() },
    );

    expect(paramsOf(statsGet.mock.calls[0])).toEqual({
      range: DASHBOARD_RANGE.d7,
      scope: DASHBOARD_SCOPE.mine,
    });
    // No `scope`: the endpoint takes none, and a key carrying one would be an
    // entry the page never reads — and a second request on every range change.
    expect(paramsOf(effectivenessGet.mock.calls[0])).toEqual({
      range: DASHBOARD_RANGE.d7,
    });
    expect(
      queryClient.getQueryData(
        ticketKeys.effectiveness({ range: DASHBOARD_RANGE.d7 }),
      ),
    ).toEqual({});
  });

  test("falls back to the defaults a malformed URL implies", async () => {
    await runLoader(dashboardLoader, "/?range=forever&scope=everyone");

    expect(paramsOf(statsGet.mock.calls[0])).toEqual({
      range: DEFAULT_DASHBOARD_RANGE,
      scope: DASHBOARD_SCOPE.all,
    });
  });
});
