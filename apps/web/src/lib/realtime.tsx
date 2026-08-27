import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { TicketEvent } from "@ticket/shared";
import { api } from "@/lib/api";
import { pipelineKeys } from "@/lib/pipeline-queries";
import { applyEvent } from "@/lib/realtime-events";
import { ticketKeys } from "@/lib/ticket-queries";
import { useAssignmentToasts } from "@/lib/use-assignment-toasts";

/**
 * The app's one connection to `GET /api/events`.
 *
 * **One `EventSource` per tab, and it lives here because there is nowhere else
 * to make one.** That is a hard rule, not a preference: an event stream holds a
 * TCP socket for its whole life, and HTTP/1.1 allows six per origin. Two streams
 * per tab plus a couple of tabs and every subsequent XHR queues behind a
 * connection that never ends — which presents as "the app hangs", with no error
 * anywhere to explain it. In dev that is a certainty rather than a risk: the Vite
 * proxy is HTTP/1.1 over localhost. So the source is private to this module,
 * nothing exports a way to make another, and screens read the status from
 * context.
 *
 * Mounted inside `ProtectedRoute`, not at the root. A provider above the router
 * would open a stream for every signed-out visitor sitting on `/login`, get a
 * 401, and retry forever.
 *
 * The shape is lifted from `apps/web/src/dev/use-test-run.ts`, which had already
 * worked out the parts that are easy to get wrong: one effect with empty deps
 * (StrictMode's double-invoke opens two otherwise), `source.close()` in cleanup,
 * and buffering events rather than rendering one per message.
 */

/** Long enough to coalesce a burst, short enough to feel immediate. */
const FLUSH_MS = 120;

/** First reconnect delay; doubles to `MAX_RETRY_MS`. */
const BASE_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

interface RealtimeStatus {
  /** True between `onopen` and the next error. Drives the fallback poll on `/pipeline`. */
  connected: boolean;
}

const RealtimeContext = createContext<RealtimeStatus>({ connected: false });

/** Whether the push channel is currently up. Safe to call outside the provider — reads `false`. */
export function useRealtimeStatus(): RealtimeStatus {
  return useContext(RealtimeContext);
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);

  // Reacts to the same stream this provider applies events from — see its
  // own comment for why it lives here rather than nearer `/tickets`.
  useAssignmentToasts();

  /** Received but not yet applied. */
  const pendingRef = useRef<TicketEvent[]>([]);

  const flush = useCallback(() => {
    const pending = pendingRef.current;
    if (pending.length === 0) return;
    pendingRef.current = [];
    for (const event of pending) applyEvent(queryClient, event);
  }, [queryClient]);

  useEffect(() => {
    const timer = setInterval(flush, FLUSH_MS);
    return () => clearInterval(timer);
  }, [flush]);

  useEffect(() => {
    // `EventSource` takes a URL, not the axios instance, so the base URL is
    // spelled out here the same way `lib/api.ts` spells it. Empty in dev and in
    // tests, where Vite proxies `/api`.
    const url = `${import.meta.env.VITE_API_URL ?? ""}/api/events`;

    let cancelled = false;
    let source: EventSource | null = null;
    let retryTimer: number | undefined;
    let attempt = 0;
    let hasConnected = false;

    const open = (): void => {
      if (cancelled) return;

      // `withCredentials`, because the session is a cookie and the API is a
      // different origin in production. CORS already allows it: the API sets
      // `credentials: true` against the same trusted origins.
      source = new EventSource(url, { withCredentials: true });

      source.onopen = () => {
        attempt = 0;
        setConnected(true);

        // On a *re*connect only: anything published while the socket was down is
        // simply gone — there is no replay buffer and deliberately so, because
        // this app's state is re-derivable and a buffer that can be trimmed is a
        // buffer that can be wrong. Re-reading what is mounted is strictly more
        // correct. `active` by default, so this costs exactly the screens the
        // user is looking at.
        if (hasConnected) {
          void queryClient.invalidateQueries({ queryKey: ticketKeys.all });
          void queryClient.invalidateQueries({ queryKey: pipelineKeys.all });
        }
        hasConnected = true;
      };

      source.onmessage = (raw) => {
        try {
          pendingRef.current.push(JSON.parse(raw.data) as TicketEvent);
        } catch {
          // A frame we cannot parse is a frame we cannot act on. Dropping it
          // costs a refresh; throwing here would take the provider down and with
          // it every screen under it.
        }
      };

      source.onerror = () => {
        // Deliberately taking over from the browser's own reconnect.
        //
        // `EventSource` retries on its own, which is normally the reason to
        // prefer it — but `onerror` cannot tell 401 from 502 from dead wifi, so
        // an expired session becomes an invisible retry loop every ~3s behind an
        // app that looks live and will never update or redirect. Closing it and
        // probing with a normal authenticated request puts the decision back
        // where it already lives: a 401 on the probe hits the interceptor in
        // `lib/api.ts` and redirects to `/login`, once.
        source?.close();
        source = null;
        setConnected(false);
        scheduleReopen();
      };
    };

    const scheduleReopen = (): void => {
      if (cancelled) return;

      const backoff = Math.min(MAX_RETRY_MS, BASE_RETRY_MS * 2 ** attempt);
      attempt += 1;
      // Jitter, so a redeploy does not bring every tab back in one pulse.
      const delay = Math.round(backoff * (0.8 + Math.random() * 0.4));

      retryTimer = window.setTimeout(() => {
        if (cancelled) return;
        // Cheap, authenticated, and already something the sidebar wants fresh.
        api
          .get("/api/tickets/views")
          .then(() => open())
          .catch(() => scheduleReopen());
      }, delay);
    };

    open();

    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
      source?.close();
    };
  }, [queryClient]);

  return (
    <RealtimeContext.Provider value={{ connected }}>
      {children}
    </RealtimeContext.Provider>
  );
}
