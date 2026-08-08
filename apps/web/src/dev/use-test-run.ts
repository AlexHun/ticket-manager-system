import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { extractErrorMessage } from "@/lib/errors";
import {
  DEVTOOLS_API,
  type CaseResult,
  type DevStreamMessage,
  type RunEvent,
  type RunSummary,
} from "./protocol";

/**
 * Watches the dev server's test runs and asks it to start and stop them.
 *
 * The runs are not owned here — the plugin owns them, and this hook is a viewer
 * with three buttons. That split is what makes a multi-minute suite usable from a
 * browser tab: starting the Playwright suite launches a second Vite over the same
 * project, which can make this dev server re-optimise its dependencies and
 * full-reload the page. When the child process belonged to the page's connection,
 * that reload killed the run every time. Now the page reconnects, the server
 * replays the backlog, and the run is still going.
 *
 * So: one `EventSource` for the page's lifetime, opened on mount whether or not
 * anything is running; `POST`s for start/cancel/clear. Navigating away stops
 * watching and nothing else.
 *
 * Events are buffered and applied on a timer rather than one render each. A
 * Playwright run emits hundreds of lines, each in its own task, and a render per
 * line makes the log stutter while it is the only thing you are watching — and on
 * reconnect the whole backlog arrives at once.
 */

export const RUN_STATUS = {
  idle: "idle",
  running: "running",
  passed: "passed",
  failed: "failed",
  cancelled: "cancelled",
} as const;

export type RunStatus = (typeof RUN_STATUS)[keyof typeof RUN_STATUS];

export interface LogLine {
  id: number;
  text: string;
  stream: "out" | "err";
}

export interface SuiteRun {
  status: RunStatus;
  lines: LogLine[];
  cases: CaseResult[];
  summary: RunSummary | null;
  durationMs: number | null;
  exitCode: number | null;
  /** A refusal from the middleware, or a command that would not start. */
  error: string | null;
  /** Lines dropped off the head of the log to stay under the cap. */
  dropped: number;
  /** Epoch ms the server started it, for the elapsed clock. */
  startedAt: number | null;
}

const EMPTY_RUN: SuiteRun = {
  status: RUN_STATUS.idle,
  lines: [],
  cases: [],
  summary: null,
  durationMs: null,
  exitCode: null,
  error: null,
  dropped: 0,
  startedAt: null,
};

/** Lines kept per suite in the page. Each one is a DOM node in the log. */
const MAX_LINES = 3000;
const FLUSH_MS = 120;

const devApi = axios.create({ baseURL: "" });

export interface TestRunner {
  runs: Record<string, SuiteRun>;
  /** The suite the server is running, if any. */
  activeId: string | null;
  /** Suites waiting behind it, in order. */
  queued: string[];
  /** Whether the event stream is open. Shown, but deliberately *not* used to
   *  disable the buttons: a POST works whether or not this page is watching, and
   *  a disabled button silently swallowed the first click on a fresh load. */
  connected: boolean;
  /** The last request that failed, so a dead dev server is visible rather than
   *  looking like a button that does nothing. */
  problem: string | null;
  /** Queue one suite behind whatever is running. */
  run: (id: string) => void;
  /** Replace the queue with these, in order. */
  runAll: (ids: string[]) => void;
  /** Stop the running suite and drop the queue. */
  cancel: () => void;
  /** Forget one suite's output. */
  clear: (id: string) => void;
}

export function useTestRunner(): TestRunner {
  const [runs, setRuns] = useState<Record<string, SuiteRun>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [queued, setQueued] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  /** Messages received but not yet rendered. */
  const pendingRef = useRef<DevStreamMessage[]>([]);
  const lineIdRef = useRef(0);

  const flush = useCallback(() => {
    const pending = pendingRef.current;
    if (pending.length === 0) return;
    pendingRef.current = [];

    setRuns((prev) => {
      const next = { ...prev };
      for (const message of pending) {
        if (message.kind !== "run") continue;
        next[message.suite] = apply(
          next[message.suite] ?? EMPTY_RUN,
          message.event,
          () => {
            lineIdRef.current += 1;
            return lineIdRef.current;
          },
        );
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const timer = setInterval(flush, FLUSH_MS);
    return () => clearInterval(timer);
  }, [flush]);

  useEffect(() => {
    const source = new EventSource(DEVTOOLS_API.events);

    source.onopen = () => setConnected(true);

    source.onmessage = (raw) => {
      let message: DevStreamMessage;
      try {
        message = JSON.parse(raw.data as string) as DevStreamMessage;
      } catch {
        return;
      }

      // Queue state is small, arrives rarely, and gates every button — applied
      // at once rather than waiting for the next flush.
      if (message.kind === "state") {
        setActiveId(message.active);
        setQueued(message.queued);
        return;
      }
      pendingRef.current.push(message);
    };

    source.onerror = () => {
      // The dev server restarted or went away. `EventSource` reconnects on its
      // own, and the replay on reconnect is what re-syncs the page — so there is
      // nothing to do here but stop claiming to be connected.
      if (source.readyState === EventSource.CONNECTING) setConnected(false);
    };

    return () => source.close();
  }, []);

  /**
   * Ask the server to do something, and report it if the ask fails.
   *
   * The *result* is deliberately ignored: what is running arrives as a `state`
   * message on the stream, and reading it from the response too would give the
   * page two sources of truth that could disagree. Only the failure is handled.
   */
  const command = useCallback(async (url: string, describe: string) => {
    setProblem(null);
    try {
      await devApi.post(url);
    } catch (err) {
      setProblem(extractErrorMessage(err, `Could not ${describe}.`));
    }
  }, []);

  const start = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      void command(
        `${DEVTOOLS_API.start}?suites=${ids.map(encodeURIComponent).join(",")}`,
        "start the run",
      );
    },
    [command],
  );

  const run = useCallback(
    (id: string) => {
      start([...queued.filter((queuedId) => queuedId !== id), id]);
    },
    [queued, start],
  );

  const runAll = useCallback((ids: string[]) => start(ids), [start]);

  const cancel = useCallback(() => {
    void command(DEVTOOLS_API.cancel, "cancel the run");
  }, [command]);

  const clear = useCallback(
    (id: string) => {
      void command(
        `${DEVTOOLS_API.clear}?suite=${encodeURIComponent(id)}`,
        "clear that output",
      );
      // Dropped locally at once: there is no stream event for clearing, and
      // waiting on the round trip would leave the output on screen after the
      // button had visibly been pressed.
      setRuns((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    [command],
  );

  return { runs, activeId, queued, connected, problem, run, runAll, cancel, clear };
}

/** One event folded into one suite's accumulated state. */
function apply(run: SuiteRun, event: RunEvent, nextLineId: () => number): SuiteRun {
  switch (event.type) {
    case "start":
      // A fresh start wipes the previous run's output rather than appending to
      // it, so the log under a card is always one run's worth.
      return { ...EMPTY_RUN, status: RUN_STATUS.running, startedAt: event.startedAt };

    case "line": {
      const lines = [...run.lines, { id: nextLineId(), text: event.text, stream: event.stream }];
      const overflow = Math.max(0, lines.length - MAX_LINES);
      return {
        ...run,
        lines: overflow > 0 ? lines.slice(overflow) : lines,
        dropped: run.dropped + overflow,
      };
    }

    case "case":
      return { ...run, cases: [...run.cases, event.case] };

    case "error":
      return { ...run, error: event.message };

    case "end":
      return {
        ...run,
        status: event.cancelled
          ? RUN_STATUS.cancelled
          : event.ok
            ? RUN_STATUS.passed
            : RUN_STATUS.failed,
        summary: event.summary,
        durationMs: event.durationMs,
        exitCode: event.exitCode,
      };
  }
}

export function runOf(runs: Record<string, SuiteRun>, id: string): SuiteRun {
  return runs[id] ?? EMPTY_RUN;
}
