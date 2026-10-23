import { describe, expect, test } from "vitest";
import { extractErrorMessage, isClientError, isNotFoundError } from "./errors";

function makeAxiosError(overrides: Record<string, unknown>) {
  return Object.assign(new Error("Request failed"), {
    isAxiosError: true,
    ...overrides,
  });
}

describe("extractErrorMessage", () => {
  test("returns response.data.error when the axios error has one", () => {
    const err = makeAxiosError({
      response: { status: 409, data: { error: "Email already in use" } },
    });
    expect(extractErrorMessage(err, "fallback")).toBe("Email already in use");
  });

  // Axios's own message names a status code, which is not copy: the fallback
  // is the sentence written for the case the API sent none.
  test("returns the fallback when an axios error has a response but no data.error", () => {
    const err = makeAxiosError({
      response: { status: 500, data: {} },
    });
    expect(extractErrorMessage(err, "fallback")).toBe("fallback");
  });

  test("returns the fallback when an axios error's body is not JSON", () => {
    const err = makeAxiosError({
      response: { status: 502, data: "<html>Bad gateway</html>" },
    });
    expect(extractErrorMessage(err, "fallback")).toBe("fallback");
  });

  test("returns the fallback when an axios error has no response (network failure)", () => {
    const err = makeAxiosError({});
    expect(extractErrorMessage(err, "fallback")).toBe("fallback");
  });

  // A thrown Error's message is written for a developer, not a reader (#502).
  test("returns the fallback for a generic Error, not its message", () => {
    expect(extractErrorMessage(new Error("boom"), "fallback")).toBe("fallback");
  });

  test("returns the fallback for a non-Error value", () => {
    expect(extractErrorMessage("just a string", "Something went wrong")).toBe(
      "Something went wrong",
    );
    expect(extractErrorMessage(null, "Something went wrong")).toBe(
      "Something went wrong",
    );
    expect(extractErrorMessage(undefined, "Something went wrong")).toBe(
      "Something went wrong",
    );
  });
});

describe("isNotFoundError", () => {
  test("is true for an axios error with a 404 response", () => {
    expect(
      isNotFoundError(
        makeAxiosError({ response: { status: 404, data: { error: "gone" } } }),
      ),
    ).toBe(true);
  });

  test("is false for other statuses", () => {
    for (const status of [400, 401, 403, 500]) {
      expect(
        isNotFoundError(makeAxiosError({ response: { status, data: {} } })),
        `status ${status}`,
      ).toBe(false);
    }
  });

  test("is false for a network failure with no response", () => {
    expect(isNotFoundError(makeAxiosError({}))).toBe(false);
  });

  test("is false for non-axios values", () => {
    expect(isNotFoundError(new Error("boom"))).toBe(false);
    expect(isNotFoundError(null)).toBe(false);
  });
});

describe("isClientError", () => {
  test("is true across the 4xx range", () => {
    for (const status of [400, 401, 403, 404, 422, 499]) {
      expect(
        isClientError(makeAxiosError({ response: { status, data: {} } })),
        `status ${status}`,
      ).toBe(true);
    }
  });

  test("is false for 5xx, so a server blip is still retried", () => {
    for (const status of [500, 502, 503]) {
      expect(
        isClientError(makeAxiosError({ response: { status, data: {} } })),
        `status ${status}`,
      ).toBe(false);
    }
  });

  test("is false when there is no response at all", () => {
    expect(isClientError(makeAxiosError({}))).toBe(false);
    expect(isClientError(new Error("boom"))).toBe(false);
  });
});
