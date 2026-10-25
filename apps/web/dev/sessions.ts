// Reads this machine's Claude Code sessions of this repository as trees: each
// session, and every subagent under it to any depth — the node half of the
// dev-tools Sessions page (`../src/dev/SessionsPage.tsx`, #590).
//
// Claude Code keeps a session's transcript at `<dir>/<session>.jsonl` and each
// subagent it started at `<dir>/<session>/subagents/agent-<id>.jsonl`, beside
// an `agent-<id>.meta.json` naming its type, its task and `toolUseId`: the id
// of the `tool_use` call that started it, in whichever transcript made the
// call. **That id is the one link the tree is drawn from.** The meta file also
// carries `spawnDepth`, and below depth 1 a `parentAgentId`, but a call is
// what a transcript records happening, so a subagent hangs under the card
// whose transcript holds the call and the other two fields are not read.
//
// The layout is undocumented and moves between Claude Code versions (the
// PRD's first risk), so a file this cannot use is a warning naming it, never
// an empty page: a meta file that does not parse leaves its subagent out, and
// one naming a call no transcript in the session made is drawn under its
// session instead.
//
// Its own reader rather than `./transcripts.ts`'s `readTranscripts`, which
// answers per response with no file on the row — and whose six fields are the
// usage history's stored row and the push's wire (ADR-0023), so they are not
// widened for this page. Instead each card keeps the responses its own file
// holds, keyed by the same `identityOf` and folded at the same largest count
// (#413, #431), and `./session-groups.ts` totals them with the Usage page's
// `tallySpend` (#593): which card a response is in is which list holds it.
//
// Read only and asynchronously, so a reading of a few hundred transcripts does
// not hold the thread Vite answers every other request on. A reader kept
// between readings (`createSessionsReader`) resumes each transcript from where
// it left off, which is what the stream polls with (#591).

import { open, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  SESSION_IDLE_MS,
  SESSION_STATE,
  type ChainView,
  type ImplementStep,
  type SessionCard,
  type SessionsReport,
  type SessionsWarning,
  type ToolTally,
} from "../src/dev/sessions-protocol.ts";
import {
  chainArgsOf,
  chainPlanOf,
  chainView,
  workerOf,
  type ChainLister,
} from "./chains.ts";
import {
  implementStepOf,
  marksOf,
  marksOfPrompt,
  type StepMark,
} from "./implement-step.ts";
import { groupSessions, type CreditedCard } from "./session-groups.ts";
import {
  identityOf,
  largerCounts,
  type TranscriptResponse,
} from "./transcripts.ts";
import { readWaiting, type WaitingRecord } from "./waiting.ts";

/** Where Claude Code puts a session's subagents, under the session's own
 *  directory — the name `./transcripts.ts` lists them under too. */
const SUBAGENTS_DIR = "subagents";

const META_SUFFIX = ".meta.json";

const TRANSCRIPT_SUFFIX = ".jsonl";

/** The `stop_reason` of a response that ended its turn, waiting on nothing. */
const END_TURN = "end_turn";

/** `agent-<id>.meta.json` → `<id>`. */
const META_FILE = /^agent-(.+)\.meta\.json$/;

/** The model Claude Code writes on a response it made up itself (an
 *  interruption, an error), which names no model that ran. */
const SYNTHETIC_MODEL = "<synthetic>";

/**
 * The fields this reads off a transcript record. Optional throughout because
 * that is what a JSONL line offers, as `./transcripts.ts` argues for its own.
 */
interface TranscriptRecord {
  type?: string;
  isMeta?: boolean;
  sessionId?: string;
  gitBranch?: string;
  uuid?: string;
  timestamp?: string;
  message?: {
    id?: string;
    model?: string;
    stop_reason?: string | null;
    content?: unknown;
    usage?: { output_tokens?: number; cache_read_input_tokens?: number };
  };
}

/** The fields this reads off `agent-<id>.meta.json`. */
interface SubagentMeta {
  agentType?: unknown;
  description?: unknown;
  toolUseId?: unknown;
  finished?: unknown;
}

/** An `Agent` call that started one of `chain`'s workers (`./chains.ts`). */
interface WorkerCall {
  callId: string;
  name: string;
  issue: number;
}

/** What one transcript says about the card it belongs to. */
interface TranscriptFacts {
  task: string | null;
  model: string | null;
  startedAt: string | null;
  elapsedMs: number | null;
  /** Each response once, at its largest count, as the Usage scan reads it. */
  responses: TranscriptResponse[];
  /** The `gitBranch` of its latest record that carries one, or null. */
  branch: string | null;
  /** The `stop_reason` of its last response, or null. */
  lastStop: string | null;
  /** Every `tool_use` id it made a call under. */
  calls: string[];
  /** What its first `/chain` prompt was given, or null without one (#594). */
  chainArgs: string | null;
  /** The calls among `calls` that started a `chain` worker, in order. */
  workerCalls: WorkerCall[];
  /** The `implement` step its calls have reached, or null (#595). */
  step: ImplementStep | null;
  /** Every tool it called, in the order it first called each (#595). */
  tools: ToolTally[];
  /**
   * Complete lines that did not parse. The unterminated last line is not
   * counted: half-written is its ordinary state while a session works.
   */
  badLines: number;
}

const NO_FACTS: TranscriptFacts = {
  task: null,
  model: null,
  startedAt: null,
  elapsedMs: null,
  responses: [],
  branch: null,
  lastStop: null,
  calls: [],
  chainArgs: null,
  workerCalls: [],
  step: null,
  tools: [],
  badLines: 0,
};

/**
 * What a transcript's lines add up to so far, fed one record at a time, so a
 * reading can resume where the last one stopped.
 */
interface FactsSoFar {
  /** The transcript as `listTranscripts` names it, which a response with no
   *  id or uuid is keyed on (`identityOf`). */
  file: string;
  /** Lines fed so far, so a resumed reading numbers the next one. */
  lines: number;
  task: string | null;
  model: string | null;
  first: string | null;
  firstMs: number;
  lastMs: number;
  lastStop: string | null;
  calls: string[];
  chainArgs: string | null;
  workerCalls: WorkerCall[];
  /** What each prompt and call said of `implement`'s progress, in order:
   *  only the marks, never the calls' inputs, which can be whole files. */
  marks: StepMark[];
  /** Calls per tool name, in the order each was first called. */
  tools: Map<string, number>;
  /** Each response by its `identityOf` key. Replaced rather than changed when
   *  a later record raises its count, so a copy of the map is a copy. */
  responses: Map<string, TranscriptResponse>;
  branch: string | null;
  badLines: number;
}

const startFacts = (file: string): FactsSoFar => ({
  file,
  lines: 0,
  task: null,
  model: null,
  first: null,
  firstMs: Infinity,
  lastMs: -Infinity,
  lastStop: null,
  calls: [],
  chainArgs: null,
  workerCalls: [],
  marks: [],
  tools: new Map(),
  responses: new Map(),
  branch: null,
  badLines: 0,
});

/** A copy that `feed` can write to without touching the original. */
const copyFacts = (f: FactsSoFar): FactsSoFar => ({
  ...f,
  calls: [...f.calls],
  workerCalls: [...f.workerCalls],
  marks: [...f.marks],
  tools: new Map(f.tools),
  responses: new Map(f.responses),
});

/** A content block of type `type`, as a transcript's `message.content`
 *  holds them. */
const isBlock = <T extends object>(
  b: unknown,
  type: string,
): b is { type: string } & T =>
  typeof b === "object" &&
  b !== null &&
  (b as { type?: unknown }).type === type;

/** A prompt's text, or null for a record that is not one. */
function promptBody(rec: TranscriptRecord): string | null {
  if (rec.type !== "user" || rec.isMeta) return null;
  const content = rec.message?.content;
  let text: string | null = null;
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    // A tool's answer comes back as a user record too; only text is a prompt.
    const block = content.find(
      (b: unknown): b is { type: string; text: string } =>
        isBlock<{ text: unknown }>(b, "text") && typeof b.text === "string",
    );
    text = block?.text ?? null;
  }
  return text;
}

/** A prompt's first non-empty line. */
const firstLine = (text: string): string | null =>
  text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0) ?? null;

const COMMAND_NAME = /<command-name>([\s\S]*?)<\/command-name>/;
const COMMAND_ARGS = /<command-args>([\s\S]*?)<\/command-args>/;

/** The task a bare `/clear` gives, which a later prompt replaces (#616). */
const CLEAR_TASK = "/clear";

/**
 * A prompt's task: a typed command as the command and its arguments, any other
 * prompt as its first line. Claude Code records a command as
 * `<command-name>`, `<command-message>` and `<command-args>` in either order,
 * the args sometimes left out (#616).
 */
function taskOf(text: string): string | null {
  const name = COMMAND_NAME.exec(text)?.[1]?.trim();
  if (!name) return firstLine(text);
  const args = COMMAND_ARGS.exec(text)?.[1]?.trim();
  return firstLine(args ? `${name} ${args}` : name);
}

type ToolUse = { type: string; id: string; name?: unknown; input?: unknown };

function toolUses(content: unknown): ToolUse[] {
  if (!Array.isArray(content)) return [];
  return content.filter(
    (b: unknown): b is ToolUse =>
      isBlock<{ id: unknown }>(b, "tool_use") && typeof b.id === "string",
  );
}

/** The tool a subagent is started with: `Agent`, `Task` before it. */
const SUBAGENT_TOOLS = new Set(["Agent", "Task"]);

/**
 * One line into `f`, its one-based number in the file being `lineNo`. An
 * unparseable line is skipped, as the Usage scan skips one, and counted only
 * when `complete`: the files are append-only JSONL, and a half-written last
 * line is their ordinary state while a session works, where a bad line above
 * it is a file the page can't fully read.
 */
function feed(
  f: FactsSoFar,
  line: string,
  lineNo: number,
  complete: boolean,
): void {
  if (!line.trim()) return;
  let rec: TranscriptRecord;
  try {
    rec = JSON.parse(line) as TranscriptRecord;
  } catch {
    if (complete) f.badLines++;
    return;
  }
  if (typeof rec !== "object" || rec === null) return;

  if (rec.timestamp) {
    const ms = Date.parse(rec.timestamp);
    if (!Number.isNaN(ms)) {
      if (ms < f.firstMs) {
        f.firstMs = ms;
        f.first = rec.timestamp;
      }
      f.lastMs = Math.max(f.lastMs, ms);
    }
  }

  const body = promptBody(rec);
  if (body !== null) {
    // The first prompt, unless it was a bare `/clear`, which says nothing of
    // the work the session went on to do (#616).
    if (f.task === null || f.task === CLEAR_TASK) {
      f.task = taskOf(body) ?? f.task;
    }
    // The first `/chain` command, wherever it falls: a conductor may have
    // opened on a `/clear` (#594).
    f.chainArgs ??= chainArgsOf(body);
    // A `/implement` typed at the prompt invokes it as a `Skill` call does.
    f.marks.push(...marksOfPrompt(body));
  }
  if (rec.gitBranch) f.branch = rec.gitBranch;

  const message = rec.message;
  if (!message) return;
  for (const use of toolUses(message.content)) {
    f.calls.push(use.id);
    if (typeof use.name !== "string") continue;
    f.tools.set(use.name, (f.tools.get(use.name) ?? 0) + 1);
    f.marks.push(...marksOf({ name: use.name, input: use.input }));
    if (!SUBAGENT_TOOLS.has(use.name)) continue;
    const worker = workerOf(use.input);
    if (worker) f.workerCalls.push({ callId: use.id, ...worker });
  }
  if (!f.model && message.model && message.model !== SYNTHETIC_MODEL) {
    f.model = message.model;
  }
  const usage = message.usage;
  if (!usage) return;
  // Every block of a response carries the same `stop_reason`, the last
  // one written being the final word.
  f.lastStop = message.stop_reason ?? null;
  // As `readTranscripts` keeps a response: under its first record's session,
  // branch and time, at the largest counts any of its records carries.
  const id = identityOf(rec, f.file, lineNo);
  const out = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const before = f.responses.get(id);
  if (!before) {
    f.responses.set(id, {
      id,
      session: rec.sessionId ?? null,
      branch: rec.gitBranch ?? null,
      at: rec.timestamp ?? null,
      out,
      cacheRead,
    });
  } else if (out > before.out || cacheRead > before.cacheRead) {
    f.responses.set(id, {
      ...before,
      ...largerCounts(before, { out, cacheRead }),
    });
  }
}

/**
 * The facts of the complete lines in `f`, plus `trailing`, the unterminated
 * last line, when it parses: a complete record Claude Code has not yet ended
 * with a newline still counts, but on a copy, so that the cursor never moves
 * past it and it counts once when its newline arrives.
 */
function factsOf(f: FactsSoFar, trailing: string): TranscriptFacts {
  let s = f;
  if (trailing.trim()) {
    s = copyFacts(f);
    feed(s, trailing, f.lines + 1, false);
  }
  return {
    task: s.task,
    model: s.model,
    startedAt: s.first,
    elapsedMs:
      s.first !== null && s.lastMs > s.firstMs ? s.lastMs - s.firstMs : null,
    responses: [...s.responses.values()],
    branch: s.branch,
    lastStop: s.lastStop,
    calls: s.calls,
    chainArgs: s.chainArgs,
    workerCalls: s.workerCalls,
    step: implementStepOf(s.marks),
    tools: [...s.tools].map(([name, calls]) => ({ name, calls })),
    badLines: s.badLines,
  };
}

/**
 * Bytes before a cursor that a resumed reading checks are still there: a file
 * that no longer holds them at that offset was replaced rather than grown,
 * and is read from the top. #418's cursors check the file's first bytes; a
 * transcript's first records are much alike from one session to the next, so
 * the bytes the cursor sits behind tell two files apart sooner.
 */
const ANCHOR_BYTES = 64;

/** Where a reading of one transcript stopped, kept for the next. */
interface Cursor {
  size: number;
  mtimeMs: number;
  /** Bytes read, up to and including the last newline. */
  offset: number;
  /** The `ANCHOR_BYTES` (or fewer) that end at `offset`. */
  anchor: Buffer;
  facts: FactsSoFar;
  /** The unterminated last line, read again next time. */
  trailing: string;
}

const NEWLINE = 0x0a;

/** Feeds `bytes`' complete lines into `facts`, and answers the rest. */
function feedBytes(
  facts: FactsSoFar,
  bytes: Buffer,
): { used: number; trailing: string } {
  const end = bytes.lastIndexOf(NEWLINE) + 1;
  const lines = bytes.subarray(0, end).toString("utf8").split("\n");
  // Every piece but the last ended in a newline; the last is empty.
  for (let i = 0; i < lines.length - 1; i++) {
    feed(facts, lines[i]!, facts.lines + i + 1, true);
  }
  facts.lines += lines.length - 1;
  return { used: end, trailing: bytes.subarray(end).toString("utf8") };
}

/**
 * Feeds `bytes` from index `skip` into `facts`, and answers the cursor that
 * leaves: `bytes` starts at byte `base` of the file, the one place both a
 * resumed and a whole reading turn what they read into a cursor.
 */
function advance(
  facts: FactsSoFar,
  bytes: Buffer,
  base: number,
  skip: number,
  mtimeMs: number,
): Cursor {
  const { used, trailing } = feedBytes(facts, bytes.subarray(skip));
  const end = skip + used;
  return {
    size: base + bytes.length,
    mtimeMs,
    offset: base + end,
    anchor: Buffer.from(bytes.subarray(Math.max(0, end - ANCHOR_BYTES), end)),
    facts,
    trailing,
  };
}

/**
 * One transcript's facts and when it was last written, reading only what was
 * appended since `cursors` last saw it — nothing at all when its size and
 * modification time are unchanged. The cursor is replaced in `cursors`.
 */
async function readTranscript(
  path: string,
  file: string,
  cursors: Map<string, Cursor>,
): Promise<{ facts: TranscriptFacts; mtimeMs: number }> {
  const st = await stat(path);
  const before = cursors.get(path);
  if (before && st.size === before.size && st.mtimeMs === before.mtimeMs) {
    return {
      facts: factsOf(before.facts, before.trailing),
      mtimeMs: st.mtimeMs,
    };
  }

  let cursor: Cursor | null = null;
  if (before && st.size >= before.offset) {
    const from = before.offset - before.anchor.length;
    const handle = await open(path, "r");
    try {
      const bytes = Buffer.alloc(st.size - from);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, from);
      const read = bytes.subarray(0, bytesRead);
      const anchor = read.subarray(0, before.anchor.length);
      if (anchor.equals(before.anchor)) {
        cursor = advance(
          before.facts,
          read,
          from,
          before.anchor.length,
          st.mtimeMs,
        );
      }
    } finally {
      await handle.close();
    }
  }

  if (!cursor) {
    cursor = advance(startFacts(file), await readFile(path), 0, 0, st.mtimeMs);
  }
  cursors.set(path, cursor);
  return { facts: factsOf(cursor.facts, cursor.trailing), mtimeMs: st.mtimeMs };
}

/**
 * An I/O error as its code (`EACCES`), never its message: Node's message
 * carries the absolute path, which spells `agent-<id>` in a word the page
 * must not use (R12) and repeats the file the warning already names.
 */
export const errorText = (err: unknown) =>
  (err as NodeJS.ErrnoException | null)?.code ??
  (err instanceof Error ? err.message : String(err));

const isMissing = (err: unknown) =>
  (err as NodeJS.ErrnoException | null)?.code === "ENOENT";

/**
 * A card plus what only the linking and the state read: the calls its
 * transcript made, and what its state is settled from once the tree is built.
 */
interface TreeNode {
  card: SessionCard;
  calls: string[];
  responses: TranscriptResponse[];
  branch: string | null;
  children: TreeNode[];
  /** When its transcript or meta file was last written, in epoch ms. */
  writtenMs: number;
  /** Whether its own record says it is over: a subagent's `finished`, or a
   *  session's last response ending its turn. */
  over: boolean;
  /** A session's Done also waits on everything under it; a subagent's
   *  `finished` is its own final word. */
  isSession: boolean;
  /** Whether a waiting record names it (`./waiting.ts`). */
  waiting: boolean;
  /** The call that started a subagent; null on a session and on a subagent
   *  no call started. */
  toolUseId: string | null;
  /** A session's `/chain` arguments and the workers it started (#594). */
  chainArgs: string | null;
  workerCalls: WorkerCall[];
}

const byStart = (a: TreeNode, b: TreeNode) =>
  (a.card.startedAt ?? "").localeCompare(b.card.startedAt ?? "");

/**
 * Settles `node`'s state and every one under it, children first, against the
 * clock (`SESSION_STATE`'s rules). Returns whether anything in the subtree is
 * Running or Waiting for you, which is what keeps a quiet parent waiting on it
 * from reading Stopped, and a session whose turn ended from reading Done.
 */
function settle(node: TreeNode, now: number, idleMs: number): boolean {
  let below = false;
  for (const child of node.children) {
    // Every child is settled, not only up to the first live one.
    if (settle(child, now, idleMs)) below = true;
  }
  const done = node.over && (!node.isSession || !below);
  const quiet = now - node.writtenMs > idleMs;
  node.card.state = done
    ? SESSION_STATE.done
    : node.waiting
      ? SESSION_STATE.waiting
      : quiet && !below
        ? SESSION_STATE.stopped
        : SESSION_STATE.running;
  node.card.children = node.children.sort(byStart).map((c) => c.card);
  return (
    node.card.state === SESSION_STATE.running ||
    node.card.state === SESSION_STATE.waiting ||
    below
  );
}

/**
 * Marks each card a waiting record names. A record naming no subagent, or one
 * the session has no card for, marks the session: the wait is real, and its
 * session is the nearest card the page can say it of. A record for a session
 * not in this reading is passed over.
 */
function markWaiting(roots: TreeNode[], records: WaitingRecord[]): void {
  const find = (node: TreeNode, id: string): TreeNode | null => {
    for (const child of node.children) {
      if (child.card.id === id) return child;
      const found = find(child, id);
      if (found) return found;
    }
    return null;
  };
  for (const { sessionId, agentId } of records) {
    const root = roots.find((r) => r.card.id === sessionId);
    if (!root) continue;
    const node = agentId === null ? root : (find(root, agentId) ?? root);
    node.waiting = true;
  }
}

/**
 * A transcript with lines above its last that did not parse is a file the page
 * can't fully read, so its card's figures may be short: said, never swallowed.
 */
function warnOfBadLines(
  file: string,
  facts: TranscriptFacts,
  warnings: SessionsWarning[],
) {
  if (facts.badLines === 0) return;
  warnings.push({
    file,
    message: `Couldn't read ${facts.badLines} ${facts.badLines === 1 ? "line" : "lines"} of this transcript, so its card may be missing figures.`,
  });
}

/** The fields a card takes straight from its transcript. */
const cardFacts = (facts: TranscriptFacts) => ({
  model: facts.model,
  startedAt: facts.startedAt,
  elapsedMs: facts.elapsedMs,
  step: facts.step,
  tools: facts.tools,
});

/** What `./session-groups.ts` reads off a settled tree. */
const toCreditedCard = (node: TreeNode): CreditedCard => ({
  id: node.card.id,
  branch: node.branch,
  responses: node.responses,
  children: node.children.map(toCreditedCard),
});

interface SubagentNode {
  node: TreeNode;
  /**
   * The call that started it, or null for a subagent no call started: a skill
   * that forks one (`/code-review`, say) writes a meta file with a `name` and
   * no `toolUseId`, seen once on this machine (2026-10-21). Nothing says
   * which card's skill it was, so it is drawn under its session.
   */
  toolUseId: string | null;
  metaFile: string;
}

/** A meta file's parse, kept until its size or modification time moves. */
interface MetaReading {
  size: number;
  mtimeMs: number;
  meta: SubagentMeta | null;
}

/** What one reader keeps between readings, by absolute path. */
interface ReaderState {
  cursors: Map<string, Cursor>;
  metas: Map<string, MetaReading>;
  /** Every path this reading looked at, so the rest can be forgotten. */
  seen: Set<string>;
}

/** One session's tree, or a warning and null when its transcript can't be read. */
async function readSession(
  dir: string,
  id: string,
  state: ReaderState,
  warnings: SessionsWarning[],
): Promise<TreeNode | null> {
  const file = `${id}${TRANSCRIPT_SUFFIX}`;
  const path = join(dir, file);
  state.seen.add(path);
  let read: Awaited<ReturnType<typeof readTranscript>>;
  try {
    read = await readTranscript(path, file, state.cursors);
  } catch (err) {
    warnings.push({
      file,
      message: `Couldn't read this session's transcript (${errorText(err)}), so it is left out.`,
    });
    return null;
  }
  const { facts } = read;
  warnOfBadLines(file, facts, warnings);
  const root: TreeNode = {
    card: {
      id,
      subagentType: null,
      task: facts.task,
      ...cardFacts(facts),
      // Settled once the whole tree is known.
      state: SESSION_STATE.running,
      children: [],
    },
    calls: facts.calls,
    responses: facts.responses,
    branch: facts.branch,
    children: [],
    writtenMs: read.mtimeMs,
    over: facts.lastStop === END_TURN,
    isSession: true,
    waiting: false,
    toolUseId: null,
    chainArgs: facts.chainArgs,
    workerCalls: facts.workerCalls,
  };

  const { nodes: subagents, unclaimed } = await readSubagents(
    dir,
    id,
    state,
    warnings,
  );
  // A subagent transcript with no card still spent what it spent, and the
  // Usage scan counts it (R7): its session's card holds it, and any call it
  // made is the session's.
  root.responses = [...root.responses, ...unclaimed.responses];
  root.calls = [...root.calls, ...unclaimed.calls];
  const callers = new Map<string, TreeNode>();
  for (const node of [root, ...subagents.map((s) => s.node)]) {
    for (const call of node.calls) callers.set(call, node);
  }
  for (const { node, toolUseId, metaFile } of subagents) {
    if (toolUseId === null) {
      root.children.push(node);
      continue;
    }
    let parent = callers.get(toolUseId);
    if (!parent || parent === node) {
      warnings.push({
        file: metaFile,
        message: `No transcript in this session made the call ${toolUseId} that started this subagent, so it is shown under its session.`,
      });
      parent = root;
    }
    parent.children.push(node);
  }
  return root;
}

/** A meta file parsed, or the reason it could not be, reusing the last parse
 *  while the file is unchanged. */
async function readMeta(
  path: string,
  state: ReaderState,
): Promise<{ meta: SubagentMeta | null; mtimeMs: number }> {
  state.seen.add(path);
  const st = await stat(path);
  const before = state.metas.get(path);
  if (before && before.size === st.size && before.mtimeMs === st.mtimeMs) {
    return before;
  }
  // A parse failure throws to the caller and is not kept: the next reading
  // tries again, which is what a meta file still being written wants.
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  const meta =
    typeof parsed === "object" && parsed !== null
      ? (parsed as SubagentMeta)
      : null;
  const reading = { size: st.size, mtimeMs: st.mtimeMs, meta };
  state.metas.set(path, reading);
  return reading;
}

/**
 * Every subagent of one session that has a usable meta file, and what the
 * transcripts of the rest hold: one whose meta file can't be read, or that has
 * none. They draw no card, but `readTranscripts` counts every `.jsonl` here,
 * so their responses are kept for the session's.
 */
async function readSubagents(
  dir: string,
  sessionId: string,
  state: ReaderState,
  warnings: SessionsWarning[],
): Promise<{
  nodes: SubagentNode[];
  unclaimed: { responses: TranscriptResponse[]; calls: string[] };
}> {
  const unclaimed = {
    responses: [] as TranscriptResponse[],
    calls: [] as string[],
  };
  /** As the warnings name it, relative to `dir`. */
  const rel = `${sessionId}/${SUBAGENTS_DIR}`;
  const abs = join(dir, sessionId, SUBAGENTS_DIR);
  let names: string[];
  try {
    names = await readdir(abs);
  } catch (err) {
    // Most sessions start no subagent and have no such directory.
    if (!isMissing(err)) {
      warnings.push({
        file: rel,
        message: `Couldn't list this session's subagents (${errorText(err)}).`,
      });
    }
    return { nodes: [], unclaimed };
  }

  const nodes: SubagentNode[] = [];
  /** Transcripts a card was drawn from. */
  const claimed = new Set<string>();
  for (const name of names.sort()) {
    const agentId = META_FILE.exec(name)?.[1];
    if (!agentId) continue;
    const metaFile = `${rel}/${name}`;
    let read: { meta: SubagentMeta | null; mtimeMs: number };
    try {
      read = await readMeta(join(abs, name), state);
    } catch (err) {
      warnings.push({
        file: metaFile,
        message: `Couldn't read this subagent's meta file (${errorText(err)}), so it is left out of the tree.`,
      });
      continue;
    }
    const { meta } = read;
    if (meta === null) {
      warnings.push({
        file: metaFile,
        message:
          "Couldn't read this subagent's meta file: it holds no object, so it is left out of the tree.",
      });
      continue;
    }

    const toolUseId =
      typeof meta.toolUseId === "string" ? meta.toolUseId : null;
    const transcript = name.slice(0, -META_SUFFIX.length) + TRANSCRIPT_SUFFIX;
    claimed.add(transcript);
    const transcriptPath = join(abs, transcript);
    state.seen.add(transcriptPath);
    let facts = NO_FACTS;
    let writtenMs = read.mtimeMs;
    try {
      const t = await readTranscript(
        transcriptPath,
        `${rel}/${transcript}`,
        state.cursors,
      );
      facts = t.facts;
      writtenMs = Math.max(writtenMs, t.mtimeMs);
      warnOfBadLines(`${rel}/${transcript}`, facts, warnings);
    } catch (err) {
      // A subagent that has only just started has a meta file and no
      // transcript yet; it is drawn from the meta file alone.
      if (!isMissing(err)) {
        warnings.push({
          file: `${rel}/${transcript}`,
          message: `Couldn't read this subagent's transcript (${errorText(err)}), so its card shows no figures.`,
        });
      }
    }

    nodes.push({
      node: {
        card: {
          id: agentId,
          subagentType:
            typeof meta.agentType === "string" ? meta.agentType : null,
          task:
            typeof meta.description === "string"
              ? meta.description
              : facts.task,
          ...cardFacts(facts),
          state: SESSION_STATE.running,
          children: [],
        },
        calls: facts.calls,
        responses: facts.responses,
        branch: facts.branch,
        children: [],
        writtenMs,
        over: meta.finished === true,
        isSession: false,
        waiting: false,
        toolUseId,
        chainArgs: null,
        workerCalls: [],
      },
      toolUseId,
      metaFile,
    });
  }

  for (const name of names) {
    if (!name.endsWith(TRANSCRIPT_SUFFIX) || claimed.has(name)) continue;
    const file = `${rel}/${name}`;
    const path = join(abs, name);
    state.seen.add(path);
    try {
      const { facts } = await readTranscript(path, file, state.cursors);
      warnOfBadLines(file, facts, warnings);
      unclaimed.responses.push(...facts.responses);
      unclaimed.calls.push(...facts.calls);
    } catch (err) {
      warnings.push({
        file,
        message: `Couldn't read this subagent's transcript (${errorText(err)}), so its session's figures may be short.`,
      });
    }
  }
  return { nodes, unclaimed };
}

/** Reads a transcript directory again and again, each time only what moved. */
export interface SessionsReader {
  /**
   * Every session in `dir` as a tree of cards, most recently started first,
   * with a warning for each file it could not use, its states settled
   * against `now` and the waiting records in `waitingDir`, when one is given.
   */
  read(
    dir: string,
    now?: number,
    waitingDir?: string,
    listChain?: ChainLister,
  ): Promise<SessionsReport>;
}

/**
 * Where each running `/chain` stands (#594, `./chains.ts`): a session whose
 * prompt ran `/chain`, while it reads Running or Waiting for you. A finished
 * or stopped chain is history the issues themselves keep, and leaving it out
 * keeps `gh` from being asked about every chain this machine ever ran.
 * Without `listChain`, or for a chain given no plan, the order is unknown.
 */
async function readChains(
  roots: TreeNode[],
  listChain: ChainLister | undefined,
): Promise<ChainView[]> {
  const chains: ChainView[] = [];
  for (const root of roots) {
    if (root.chainArgs === null) continue;
    const { state } = root.card;
    if (state !== SESSION_STATE.running && state !== SESSION_STATE.waiting) {
      continue;
    }
    const byCall = new Map(
      root.children.flatMap((c) =>
        c.toolUseId === null ? [] : [[c.toolUseId, c.card] as const],
      ),
    );
    const workers = root.workerCalls.map(({ callId, name, issue }) => {
      const card = byCall.get(callId) ?? null;
      return {
        name,
        issue,
        cardId: card?.id ?? null,
        state: card?.state ?? null,
      };
    });
    const plan = chainPlanOf(root.chainArgs);
    const listing =
      plan !== null && listChain !== undefined ? await listChain(plan) : null;
    chains.push(chainView({ sessionId: root.card.id, plan, workers }, listing));
  }
  return chains;
}

/**
 * A reader that keeps a cursor per transcript between readings, so the next
 * reading parses only what was appended — and opens nothing whose size and
 * modification time are unchanged — as the Usage scan's cursors do (#418).
 * That is what lets the stream poll (`./sessions-stream.ts`). Measured
 * 2026-10-21 on Windows over this machine's 206 sessions (735 transcripts):
 * the first reading took 15-20s, and each one after it 457-818ms on Bun
 * (median 532ms) and 534-972ms on Node (median 587ms), ten readings each a
 * second apart while a session wrote. A path a reading no longer finds is
 * forgotten.
 *
 * A directory that does not exist is an empty reading rather than a warning:
 * it is the ordinary state of a clone Claude Code has never opened, and the
 * page's empty state names the directory it looked in.
 */
export function createSessionsReader(
  idleMs: number = SESSION_IDLE_MS,
): SessionsReader {
  const cursors = new Map<string, Cursor>();
  const metas = new Map<string, MetaReading>();

  return {
    async read(dir, now = Date.now(), waitingDir, listChain) {
      const state: ReaderState = { cursors, metas, seen: new Set() };
      const warnings: SessionsWarning[] = [];
      const roots: TreeNode[] = [];
      let names: string[] = [];
      try {
        names = await readdir(dir);
      } catch (err) {
        if (!isMissing(err)) {
          warnings.push({
            file: ".",
            message: `Couldn't list the transcript directory (${errorText(err)}).`,
          });
        }
      }
      // One session at a time. All of them at once read a little faster warm
      // (a median of 375ms against 532ms, 2026-10-21) and would hold every
      // transcript in memory together on a cold reading, 605 MB here.
      for (const name of names.sort()) {
        if (!name.endsWith(TRANSCRIPT_SUFFIX)) continue;
        const root = await readSession(
          dir,
          name.slice(0, -TRANSCRIPT_SUFFIX.length),
          state,
          warnings,
        );
        if (root) roots.push(root);
      }
      // Read every time, never kept: a handful of small files, and a record
      // removed must clear its card on the next reading.
      if (waitingDir !== undefined) {
        markWaiting(roots, await readWaiting(waitingDir));
      }
      for (const root of roots) settle(root, now, idleMs);
      roots.sort((a, b) => byStart(b, a));
      const chains = await readChains(roots, listChain);
      for (const path of cursors.keys()) {
        if (!state.seen.has(path)) cursors.delete(path);
      }
      for (const path of metas.keys()) {
        if (!state.seen.has(path)) metas.delete(path);
      }
      return {
        transcriptDir: dir,
        gatheredAt: new Date(now).toISOString(),
        sessions: roots.map((r) => r.card),
        groups: groupSessions(roots.map(toCreditedCard)),
        chains,
        warnings,
      };
    },
  };
}

/** One reading with nothing kept, for a caller that reads once, as the unit
 *  tests do. */
export const readSessions = (
  dir: string,
  now?: number,
  waitingDir?: string,
  listChain?: ChainLister,
) => createSessionsReader().read(dir, now, waitingDir, listChain);
