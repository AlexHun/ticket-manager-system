import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  SESSION_GROUP_KIND,
  SESSION_STATE,
  type SessionCard,
  type SessionsReport,
  type SessionsStreamMessage,
  type SessionState,
} from "./sessions-protocol";
import { SessionsPage } from "./SessionsPage";

/**
 * What one reading re-renders (#689). Every card has its own elapsed time, and
 * `formatElapsed` is called once each time a card renders, so the times it is
 * called with name the cards that rendered; `issueGroupTitle` does the same
 * for each issue group. Measured on this machine's 1,300
 * cards before the change, a reading re-rendered every one of them, 2.6-4.9s
 * of main thread each.
 */
const rendered = vi.hoisted(() => [] as (number | null)[]);
const groupsRendered = vi.hoisted(() => [] as number[]);
vi.mock("./sessions-copy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sessions-copy")>();
  return {
    ...actual,
    formatElapsed: (ms: number | null) => {
      rendered.push(ms);
      return actual.formatElapsed(ms);
    },
    issueGroupTitle: (issue: number) => {
      groupsRendered.push(issue);
      return actual.issueGroupTitle(issue);
    },
  };
});

/** The stream, answered by the test rather than the dev server. */
class StubEventSource {
  static readonly CLOSED = 2;
  static current: StubEventSource | null = null;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    StubEventSource.current = this;
  }
  close() {}
}

const send = (report: SessionsReport) => {
  const message: SessionsStreamMessage = { kind: "report", report };
  // Serialised and parsed, as the stream hands it over, so no object is
  // shared with the last reading by accident.
  act(() =>
    StubEventSource.current!.onmessage!({ data: JSON.stringify(message) }),
  );
};

const card = (
  id: string,
  elapsedMs: number,
  state: SessionState = SESSION_STATE.running,
  children: SessionCard[] = [],
): SessionCard => ({
  id,
  subagentType: null,
  task: `Task ${id}`,
  model: null,
  state,
  startedAt: null,
  elapsedMs,
  step: null,
  tools: [],
  children,
});

/** A session with two subagents, and a second session, in an issue group
 *  each. */
const reading = (firstSubagent: SessionState): SessionsReport => ({
  transcriptDir: "/transcripts",
  gatheredAt: "2026-11-01T10:00:00.000Z",
  sessions: [
    card("s1", 1_000, SESSION_STATE.running, [
      card("a1", 2_000, firstSubagent),
      card("a2", 3_000),
    ]),
    card("s2", 4_000, SESSION_STATE.done),
  ],
  groups: [
    {
      key: "issue:101",
      kind: SESSION_GROUP_KIND.issue,
      issue: 101,
      out: 3,
      sessions: [
        {
          id: "s1",
          out: 1,
          subtreeOut: 3,
          children: [
            { id: "a1", out: 1, subtreeOut: 1, children: [] },
            { id: "a2", out: 1, subtreeOut: 1, children: [] },
          ],
        },
      ],
    },
    {
      key: "issue:102",
      kind: SESSION_GROUP_KIND.issue,
      issue: 102,
      out: 1,
      sessions: [{ id: "s2", out: 1, subtreeOut: 1, children: [] }],
    },
  ],
  chains: [],
  warnings: [],
});

const stateOf = (id: string) =>
  within(
    document.querySelector<HTMLElement>(`[data-session-card="${id}"]`)!,
  ).getAllByText(/^(Running|Done|Stopped|Waiting for you)$/)[0]!.textContent;

beforeEach(() => {
  rendered.length = 0;
  groupsRendered.length = 0;
  vi.stubGlobal("EventSource", StubEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SessionsPage", () => {
  test("a reading that changes one subagent re-renders it, the session above it and its group, and nothing else", () => {
    render(<SessionsPage />);
    send(reading(SESSION_STATE.running));
    expect(
      screen.getByRole("heading", { name: "Task a1" }),
    ).toBeInTheDocument();
    expect(rendered).toEqual([1_000, 2_000, 3_000, 4_000]);
    expect(groupsRendered).toEqual([101, 102]);

    rendered.length = 0;
    groupsRendered.length = 0;
    send(reading(SESSION_STATE.done));
    expect(stateOf("a1")).toBe(SESSION_STATE.done);
    expect(rendered).toEqual([1_000, 2_000]);
    expect(groupsRendered).toEqual([101]);
  });

  test("a reading that changes nothing a card shows re-renders no card and no group", () => {
    render(<SessionsPage />);
    send(reading(SESSION_STATE.running));
    expect(groupsRendered).toEqual([101, 102]);
    rendered.length = 0;
    groupsRendered.length = 0;
    send({
      ...reading(SESSION_STATE.running),
      gatheredAt: "2026-11-01T10:00:02.000Z",
    });
    expect(screen.getByText(/last changed at/)).toHaveTextContent(
      new Date("2026-11-01T10:00:02.000Z").toLocaleTimeString("en-GB"),
    );
    expect(stateOf("a2")).toBe(SESSION_STATE.running);
    expect(rendered).toEqual([]);
    expect(groupsRendered).toEqual([]);
  });
});
