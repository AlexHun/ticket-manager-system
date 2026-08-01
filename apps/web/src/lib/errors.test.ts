import { describe, expect, test } from "vitest";
import { extractErrorMessage } from "./errors";

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

  test("falls back to err.message when axios error has a response but no data.error", () => {
    const err = makeAxiosError({
      response: { status: 500, data: {} },
    });
    expect(extractErrorMessage(err, "fallback")).toBe("Request failed");
  });

  test("falls back to err.message when axios error has no response (network failure)", () => {
    const err = makeAxiosError({});
    expect(extractErrorMessage(err, "fallback")).toBe("Request failed");
  });

  test("returns err.message for a generic Error", () => {
    expect(extractErrorMessage(new Error("boom"), "fallback")).toBe("boom");
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
