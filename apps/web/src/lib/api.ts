import axios from "axios";
import type { AxiosError } from "axios";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "",
  withCredentials: true,
});

/**
 * The one place that notices the session has gone.
 *
 * Sessions here are cookies with a server-side lifetime, so they expire while
 * the tab is still open and every query afterwards answers 401. Without this,
 * that surfaces as whatever inline error the calling screen renders — "Failed
 * to load tickets" in red next to an empty table — which reads as a broken app
 * rather than as being signed out, and leaves no way forward but a manual
 * reload.
 *
 * Deliberately a full navigation rather than a router `navigate`: this module
 * is imported by plain query functions that have no router context, and the
 * reload is doing real work — it drops the react-query cache, which is a signed
 * -out user's data and should not survive the redirect.
 *
 * Only 401. A 403 is a *signed-in* user reaching past their role, which the
 * route guards already handle and which must not bounce anyone to a login form
 * they are already past. The `/login` guard stops a failed request on the login
 * screen from reloading it in a loop.
 */
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (
      error.response?.status === 401 &&
      window.location.pathname !== "/login"
    ) {
      window.location.assign("/login");
    }
    return Promise.reject(error);
  },
);
