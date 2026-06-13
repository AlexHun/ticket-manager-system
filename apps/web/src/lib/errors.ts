import axios from "axios";

export function extractErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const responseError = (err.response?.data as { error?: string } | undefined)?.error;
    return responseError ?? err.message;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}
