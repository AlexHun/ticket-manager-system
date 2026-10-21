import { useEffect, useState } from "react";
import { DEVTOOLS_API } from "./devtools-paths";
import type {
  SessionsReport,
  SessionsStreamMessage,
} from "./sessions-protocol";

/**
 * Follows this machine's sessions of this repository as they change (#591):
 * one `EventSource` on `DEVTOOLS_API.sessions` for as long as the page is
 * mounted, as `useTestRunner` holds one on the test runner's stream. The dev
 * server sends the reading when the page connects and again whenever it
 * changes (`apps/web/dev/sessions-stream.ts`), and reads nothing once no page
 * is open, so leaving the page is what stops it.
 *
 * Not react-query: there is nothing to cache or refetch, only the latest
 * reading the server pushed. `EventSource` reconnects on its own after a
 * dev-server restart, and the reading it is handed on reconnecting is what
 * brings the page level again.
 */
export interface SessionsStreamState {
  /** The latest reading, or null before the first arrives. */
  report: SessionsReport | null;
  /** The server's own account of a reading that threw, until one succeeds. */
  problem: string | null;
  /** The stream dropped and has not come back yet. */
  lost: boolean;
}

export function useSessionsStream(): SessionsStreamState {
  const [report, setReport] = useState<SessionsReport | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [lost, setLost] = useState(false);

  useEffect(() => {
    const source = new EventSource(DEVTOOLS_API.sessions);
    source.onopen = () => setLost(false);
    source.onmessage = (raw) => {
      let message: SessionsStreamMessage;
      try {
        message = JSON.parse(raw.data as string) as SessionsStreamMessage;
      } catch {
        return;
      }
      if (message.kind === "report") {
        setReport(message.report);
        setProblem(null);
      } else {
        setProblem(message.message);
      }
    };
    source.onerror = () => setLost(true);
    return () => source.close();
  }, []);

  return { report, problem, lost };
}
