import axios from "axios";
import { demoAiLimitSchema } from "@ticket/core";

/**
 * A 404 is an answer, not a failure — callers use this to render "not found"
 * as a destination rather than as an error.
 */
export function isNotFoundError(err: unknown): boolean {
  return axios.isAxiosError(err) && err.response?.status === 404;
}

/**
 * True when the server rejected the request itself (4xx). Retrying one of these
 * can only produce the same answer more slowly, so queries use it to stop
 * react-query's default backoff from sitting on a 400 or a 404 for seconds.
 */
export function isClientError(err: unknown): boolean {
  const status = axios.isAxiosError(err) ? err.response?.status : undefined;
  return status !== undefined && status >= 400 && status < 500;
}

/**
 * The demo sessions' daily AI budget is spent (#321, PRD R8): the server made
 * no call and says so with a 429 carrying `reason`. The per-user rate limit
 * answers 429 too, without one, so the status alone cannot tell them apart.
 * Callers show this in place of the result rather than as an error — trying
 * again will not help until 00:00 UTC.
 */
export function isDemoAiLimit(err: unknown): boolean {
  return (
    axios.isAxiosError(err) &&
    demoAiLimitSchema.safeParse(err.response?.data).success
  );
}

export function extractErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const responseError = (err.response?.data as { error?: string } | undefined)
      ?.error;
    return responseError ?? err.message;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}
