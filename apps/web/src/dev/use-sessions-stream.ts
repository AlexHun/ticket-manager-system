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
  /**
   * Whether the stream is up: `reconnecting` after it dropped, while
   * `EventSource` tries again on its own, and `closed` once it has given up,
   * which it does on an answer that is not an event stream and never undoes.
   */
  connection: SessionsConnection;
}

export type SessionsConnection = "open" | "reconnecting" | "closed";

export function useSessionsStream(): SessionsStreamState {
  const [report, setReport] = useState<SessionsReport | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [connection, setConnection] = useState<SessionsConnection>("open");

  useEffect(() => {
    const source = new EventSource(DEVTOOLS_API.sessions);
    source.onopen = () => setConnection("open");
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
    source.onerror = () =>
      setConnection(
        source.readyState === EventSource.CLOSED ? "closed" : "reconnecting",
      );
    return () => source.close();
  }, []);

  return { report, problem, connection };
}
