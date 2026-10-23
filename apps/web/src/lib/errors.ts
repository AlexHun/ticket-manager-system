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

/**
 * The sentence a person reads when a request fails: the API's own `error`
 * when it sent one, otherwise `fallback`. It never shows an error's `message`:
 * an axios error's is transport text ("Request failed with status code 409",
 * "Network Error"), and neither that nor a status code is copy
 * (`docs/standards/copy.md`); any other `Error`'s was written for a developer
 * (#502). The fallback is the "Couldn't …" sentence written for exactly the
 * case the API sent nothing.
 */
export function extractErrorMessage(err: unknown, fallback: string): string {
  if (!axios.isAxiosError(err)) return fallback;
  const responseError = (err.response?.data as { error?: string } | undefined)
    ?.error;
  return typeof responseError === "string" && responseError !== ""
    ? responseError
    : fallback;
}
