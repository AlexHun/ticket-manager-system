import { describe, expect, test } from "vitest";
import { AUTH_UNREACHABLE_MESSAGE, authFailure } from "./auth-failure";

const FALLBACK = "The page's own sentence.";
const RATE_LIMITED = "The page's sentence for a 429.";
const COPY = { fallback: FALLBACK, byStatus: { 429: RATE_LIMITED } };

function resolvesWith(error: { status?: number; message?: string } | null) {
  return () => Promise.resolve({ data: null, error });
}

describe("authFailure", () => {
  test("says nothing when the call succeeds", async () => {
    expect(await authFailure(resolvesWith(null), COPY)).toBeNull();
  });

  // Better Auth's own wording is not the copy standard's (#502).
  test("answers a resolved error with the page's sentence, not Better Auth's", async () => {
    const said = await authFailure(
      resolvesWith({ status: 401, message: "Invalid email or password" }),
      COPY,
    );

    expect(said).toBe(FALLBACK);
  });

  // An unreachable server is no `error`: the client rejects with fetch's own
  // TypeError (#739).
  test("reads a rejected call as unreachable", async () => {
    const said = await authFailure(
      () => Promise.reject(new TypeError("Failed to fetch")),
      COPY,
    );

    expect(said).toBe(AUTH_UNREACHABLE_MESSAGE);
  });

  test("reads a call that throws before it returns a promise as unreachable", async () => {
    const said = await authFailure(() => {
      throw new TypeError("Failed to fetch");
    }, COPY);

    expect(said).toBe(AUTH_UNREACHABLE_MESSAGE);
  });

  test.each([0, 500, 502, 503])(
    "reads status %i as unreachable, not as the page's sentence",
    async (status) => {
      const said = await authFailure(
        resolvesWith({ status, message: "Internal Server Error" }),
        COPY,
      );

      expect(said).toBe(AUTH_UNREACHABLE_MESSAGE);
    },
  );

  // A server fault outranks the page's own statuses: a 5xx is never mapped to
  // a page's sentence even if a page names it.
  test("reads a 5xx as unreachable even when the page names that status", async () => {
    const said = await authFailure(resolvesWith({ status: 503 }), {
      fallback: FALLBACK,
      byStatus: { 503: "A page's sentence for a 503." },
    });

    expect(said).toBe(AUTH_UNREACHABLE_MESSAGE);
  });

  // Why a missing status is not unreachable is `authFailure`'s doc comment.
  test("answers a missing status with the page's sentence", async () => {
    expect(await authFailure(resolvesWith({}), COPY)).toBe(FALLBACK);
  });

  test("maps a page-specific status to the page's sentence for it", async () => {
    const said = await authFailure(
      resolvesWith({ status: 429, message: "Too many requests" }),
      COPY,
    );

    expect(said).toBe(RATE_LIMITED);
  });

  test("falls back to the page's sentence for a status the page does not name", async () => {
    const said = await authFailure(resolvesWith({ status: 403 }), COPY);

    expect(said).toBe(FALLBACK);
  });
});
