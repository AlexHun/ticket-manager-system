import axios from "axios";

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

export function extractErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const responseError = (err.response?.data as { error?: string } | undefined)?.error;
    return responseError ?? err.message;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}
