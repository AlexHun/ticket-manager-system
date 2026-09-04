import { beforeEach, describe, expect, test } from "vitest";
import { TUTORIAL_PAGE_KEY, type TutorialStatusResponse } from "@ticket/shared";
import { api, apiStub } from "./api-stub";

/**
 * The stub's own contract. Every page test that migrates onto it (#155, #156)
 * inherits these, so they are held here rather than re-proved per page.
 *
 * Each test uses its own path family: registrations live for the file, and
 * `reset()` deliberately restores implementations rather than forgetting
 * routes — that is what lets a test file name its endpoints once at the top.
 */
beforeEach(() => {
  apiStub.reset();
});

describe("apiStub", () => {
  test("routes a request to the responder registered for its path", async () => {
    apiStub.get("/api/alpha").mockResolvedValue({ data: "alpha" });

    await expect(api.get("/api/alpha")).resolves.toEqual({ data: "alpha" });
  });

  test("passes the URL and the axios config through to the responder", async () => {
    const alpha = apiStub.get("/api/alpha");
    alpha.mockResolvedValue({ data: "alpha" });

    await api.get("/api/alpha", { params: { page: 2 } });

    expect(alpha).toHaveBeenCalledWith("/api/alpha", { params: { page: 2 } });
  });

  test("keeps each path's calls out of the others' indices", async () => {
    const alpha = apiStub.get("/api/alpha");
    const gamma = apiStub.get("/api/gamma");
    alpha.mockResolvedValue({ data: "alpha" });
    gamma.mockResolvedValue({ data: "gamma" });

    await api.get("/api/gamma");
    await api.get("/api/alpha", { params: { page: 2 } });

    // The reason the hand-rolled routers needed a `calls.filter(...)` helper:
    // here the second endpoint's call simply is not in the first's list.
    expect(alpha).toHaveBeenCalledTimes(1);
    expect(alpha.mock.calls[0][1]).toEqual({ params: { page: 2 } });
  });

  test("separates the same path by method", async () => {
    apiStub.get("/api/alpha").mockResolvedValue({ data: "read" });
    const post = apiStub.post("/api/alpha");
    post.mockResolvedValue({ data: "written" });

    await expect(api.get("/api/alpha")).resolves.toEqual({ data: "read" });
    await expect(api.post("/api/alpha")).resolves.toEqual({ data: "written" });
    expect(post).toHaveBeenCalledTimes(1);
  });

  test("matches a pattern path", async () => {
    apiStub.get("/api/beta/:id").mockResolvedValue({ data: "one beta" });

    await expect(api.get("/api/beta/42")).resolves.toEqual({ data: "one beta" });
  });

  test("prefers a literal registration over a pattern that also matches", async () => {
    apiStub.get("/api/delta/:id").mockResolvedValue({ data: "any delta" });
    apiStub.get("/api/delta/7").mockResolvedValue({ data: "delta seven" });

    await expect(api.get("/api/delta/7")).resolves.toEqual({
      data: "delta seven",
    });
    await expect(api.get("/api/delta/8")).resolves.toEqual({
      data: "any delta",
    });
  });

  test("ignores the query string when matching", async () => {
    apiStub.get("/api/epsilon").mockResolvedValue({ data: "epsilon" });

    await expect(api.get("/api/epsilon?page=2")).resolves.toEqual({
      data: "epsilon",
    });
  });

  test("names an unregistered request rather than resolving undefined", () => {
    expect(() => api.get("/api/never-registered")).toThrow(
      /Unexpected GET \/api\/never-registered/,
    );
  });

  test("names a registered path that this test gave no response", () => {
    apiStub.get("/api/zeta");

    // The point of the throw: a query that resolves `undefined` fails four
    // assertions later, on a missing row, saying nothing about the cause.
    expect(() => api.get("/api/zeta")).toThrow(/registered no response/);
  });

  describe("the tutorial callout", () => {
    const statusUrl = `/api/tutorials/${TUTORIAL_PAGE_KEY.tickets}`;

    test("is answered by default, so no page test has to branch for it", async () => {
      const { data } = (await api.get(statusUrl)) as {
        data: TutorialStatusResponse;
      };

      expect(data.tutorial.shouldShow).toBe(false);
      expect(data.tutorial.content.pageKey).toBe(TUTORIAL_PAGE_KEY.tickets);
      await expect(api.post(`${statusUrl}/seen`)).resolves.toEqual({ data: {} });
    });

    test("can be overridden by a test that is actually about it", async () => {
      apiStub.get("/api/tutorials/:pageKey").mockResolvedValue({
        data: { tutorial: { content: { steps: [] }, shouldShow: true } },
      });

      const { data } = (await api.get(statusUrl)) as {
        data: TutorialStatusResponse;
      };
      expect(data.tutorial.shouldShow).toBe(true);
    });

    test("comes back after reset, unlike a plain mockReset", async () => {
      apiStub.get("/api/tutorials/:pageKey").mockResolvedValue({
        data: { tutorial: { content: { steps: [] }, shouldShow: true } },
      });
      apiStub.reset();

      const { data } = (await api.get(statusUrl)) as {
        data: TutorialStatusResponse;
      };
      expect(data.tutorial.shouldShow).toBe(false);
    });
  });

  test("reset clears recorded calls without invalidating the handle", async () => {
    const alpha = apiStub.get("/api/alpha");
    alpha.mockResolvedValue({ data: "alpha" });
    await api.get("/api/alpha");
    expect(alpha).toHaveBeenCalledTimes(1);

    apiStub.reset();

    expect(alpha).toHaveBeenCalledTimes(0);
    // Same `vi.fn` either side of the reset, which is what lets a test file
    // capture its endpoints once at the top.
    expect(apiStub.get("/api/alpha")).toBe(alpha);
  });
});
