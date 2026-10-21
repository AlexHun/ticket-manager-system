import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSIONS_POLL_MS, sessionsStream } from "./sessions-stream.ts";
import type {
  SessionsReport,
  SessionsStreamMessage,
} from "../src/dev/sessions-protocol.ts";

/**
 * Slice 2 (#591): the stream polls the reader while a page listens, sends a
 * reading only when it changed, and stops reading when the last page leaves.
 * The reader is a stub counting its calls, and the clock is Vitest's.
 */

const report = (
  out: number,
  at = "2026-10-21T12:00:00.000Z",
): SessionsReport => ({
  transcriptDir: "/t",
  gatheredAt: at,
  sessions: [
    {
      id: "s",
      subagentType: null,
      task: null,
      model: null,
      state: "Running",
      startedAt: null,
      elapsedMs: null,
      children: [],
    },
  ],
  groups: [
    {
      key: "other",
      kind: "other",
      out,
      sessions: [{ id: "s", out, subtreeOut: out, children: [] }],
    },
  ],
  chains: [],
  warnings: [],
});

let out: number;
let read: ReturnType<typeof vi.fn<() => Promise<SessionsReport>>>;

beforeEach(() => {
  vi.useFakeTimers();
  out = 1;
  let n = 0;
  // A fresh clock on every reading, as the real reader stamps one.
  read = vi.fn(() => Promise.resolve(report(out, new Date(n++).toISOString())));
});

afterEach(() => {
  vi.useRealTimers();
});

/** Lets the stub's promise, and the stream's handling of it, run to the end. */
const flush = () => vi.advanceTimersByTimeAsync(0);

const outs = (messages: SessionsStreamMessage[]) =>
  messages.map((m) =>
    m.kind === "report" ? m.report.groups[0]?.out : m.message,
  );

describe("sessionsStream", () => {
  it("reads nothing until a page listens, then sends the reading at once", async () => {
    const stream = sessionsStream(read);
    await vi.advanceTimersByTimeAsync(SESSIONS_POLL_MS * 3);
    expect(read).not.toHaveBeenCalled();

    const got: SessionsStreamMessage[] = [];
    stream.subscribe((m) => got.push(m));
    await flush();

    expect(read).toHaveBeenCalledTimes(1);
    expect(outs(got)).toEqual([1]);
  });

  it("sends a reading again only when it changed, its clock aside", async () => {
    const stream = sessionsStream(read);
    const got: SessionsStreamMessage[] = [];
    stream.subscribe((m) => got.push(m));
    await flush();

    await vi.advanceTimersByTimeAsync(SESSIONS_POLL_MS * 2);
    expect(read).toHaveBeenCalledTimes(3);
    expect(outs(got)).toEqual([1]);

    out = 2;
    await vi.advanceTimersByTimeAsync(SESSIONS_POLL_MS);

    expect(outs(got)).toEqual([1, 2]);
  });

  it("stops reading when the last page leaves, and reads afresh for the next", async () => {
    const stream = sessionsStream(read);
    const first = stream.subscribe(() => {});
    const second = stream.subscribe(() => {});
    await flush();

    first();
    await vi.advanceTimersByTimeAsync(SESSIONS_POLL_MS);
    expect(read).toHaveBeenCalledTimes(2);

    second();
    await vi.advanceTimersByTimeAsync(SESSIONS_POLL_MS * 5);
    expect(read).toHaveBeenCalledTimes(2);

    // Reopened: a new reading, never the one from before everybody left.
    out = 3;
    const got: SessionsStreamMessage[] = [];
    stream.subscribe((m) => got.push(m));
    await flush();

    expect(read).toHaveBeenCalledTimes(3);
    expect(outs(got)).toEqual([3]);
  });

  it("hands a page that joins the latest reading without waiting for the next", async () => {
    const stream = sessionsStream(read);
    stream.subscribe(() => {});
    await flush();

    const got: SessionsStreamMessage[] = [];
    stream.subscribe((m) => got.push(m));

    expect(outs(got)).toEqual([1]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("starts no reading while one is still going", async () => {
    let finish!: (r: SessionsReport) => void;
    read.mockImplementationOnce(
      () => new Promise<SessionsReport>((resolve) => (finish = resolve)),
    );
    const stream = sessionsStream(read);
    const got: SessionsStreamMessage[] = [];
    stream.subscribe((m) => got.push(m));

    await vi.advanceTimersByTimeAsync(SESSIONS_POLL_MS * 3);
    expect(read).toHaveBeenCalledTimes(1);

    finish(report(9));
    await flush();
    expect(outs(got)).toEqual([9]);
  });

  it("sends a reading that threw as an error, once, and recovers", async () => {
    read.mockRejectedValueOnce(new Error("EBUSY"));
    read.mockRejectedValueOnce(new Error("EBUSY"));
    const stream = sessionsStream(read);
    const got: SessionsStreamMessage[] = [];
    stream.subscribe((m) => got.push(m));
    await flush();
    await vi.advanceTimersByTimeAsync(SESSIONS_POLL_MS * 2);

    expect(got.map((m) => m.kind)).toEqual(["error", "report"]);
    expect(got[0]).toMatchObject({ message: expect.stringContaining("EBUSY") });
  });

  it("stops reading when closed, whoever is still listening", async () => {
    const stream = sessionsStream(read);
    stream.subscribe(() => {});
    await flush();

    stream.close();
    await vi.advanceTimersByTimeAsync(SESSIONS_POLL_MS * 5);

    expect(read).toHaveBeenCalledTimes(1);
  });
});
