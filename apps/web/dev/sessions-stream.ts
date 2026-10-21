// The Sessions page's live half (#591, slice 2 of
// `docs/plans/dev-tools-sessions-page.md`): while a page is open, read the
// transcripts every `SESSIONS_POLL_MS` and send the reading to every open page
// whenever it changed — a new subagent, new tokens, a change of state.
//
// **Polling, not a file watcher, and that was measured rather than assumed.**
// R4 asks for a change on the page within 5 seconds. A reader kept between
// readings resumes each transcript from its cursor (`./sessions.ts`) and took
// 457-972ms per reading on Windows over this machine's 735 transcripts, so a
// change waits at most one interval plus one reading, about 3s. A watcher
// would answer sooner, but could not replace the clock: Stopped is a session
// going quiet, which no file event announces, so the readings on a timer stay
// either way and a watcher would only add a second way in.
//
// Reads only while a page listens: the first page to connect starts the
// clock and the last to leave stops it, dropping the last reading, so a page
// that opens later is never handed one from before everybody left.

import type {
  SessionsReport,
  SessionsStreamMessage,
} from "../src/dev/sessions-protocol.ts";
import { errorText } from "./sessions.ts";

/**
 * How often an open page's transcripts are read again. With a reading's
 * measured 1s at worst, a change reaches the page in about 3s, inside R4's 5.
 */
export const SESSIONS_POLL_MS = 2000;

export interface SessionsStream {
  /** Starts sending to `send`, at once if there is a reading already; the
   *  returned function stops. */
  subscribe(send: (message: SessionsStreamMessage) => void): () => void;
  /** Stops reading and forgets every listener: the dev server is closing. */
  close(): void;
}

/** A key two readings share when they are the same reading: everything but
 *  their clock. */
const readingKey = ({ gatheredAt: _, ...rest }: SessionsReport) =>
  JSON.stringify(rest);

export function sessionsStream(
  read: () => Promise<SessionsReport>,
  intervalMs: number = SESSIONS_POLL_MS,
): SessionsStream {
  const listeners = new Set<(message: SessionsStreamMessage) => void>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let last: { message: SessionsStreamMessage; key: string } | null = null;
  let reading = false;

  const tick = async () => {
    // A reading slower than the interval is not stacked on.
    if (reading) return;
    reading = true;
    let message: SessionsStreamMessage;
    let key: string;
    try {
      const report = await read();
      message = { kind: "report", report };
      key = readingKey(report);
    } catch (err) {
      // Its code where it has one, never a path-bearing message (R12).
      const why = errorText(err);
      message = {
        kind: "error",
        message: `Couldn't read the transcripts (${why}). The dev server reads them again every ${intervalMs / 1000} seconds.`,
      };
      key = `error:${why}`;
    } finally {
      reading = false;
    }
    // Everybody left while it read.
    if (timer === null) return;
    if (key === last?.key) return;
    last = { message, key };
    for (const send of listeners) send(message);
  };

  const stop = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
    last = null;
  };

  return {
    subscribe(send) {
      listeners.add(send);
      if (last) send(last.message);
      if (timer === null) {
        timer = setInterval(() => void tick(), intervalMs);
        void tick();
      }
      return () => {
        listeners.delete(send);
        if (listeners.size === 0) stop();
      };
    },
    close() {
      listeners.clear();
      stop();
    },
  };
}
