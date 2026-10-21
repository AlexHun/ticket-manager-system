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
// widened for this page. The counting rule is the same one, each response once
// at its largest count (#413, #431); slice 4 of the plan is where the page's
// figures are held level with the Usage page's.
//
// Read only, per request, and asynchronously, so a reading of a few hundred
// transcripts does not hold the thread Vite answers every other request on.

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  SESSION_STATE,
  type SessionCard,
  type SessionsReport,
  type SessionsWarning,
} from "../src/dev/sessions-protocol.ts";

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
  timestamp?: string;
  message?: {
    id?: string;
    model?: string;
    stop_reason?: string | null;
    content?: unknown;
    usage?: { output_tokens?: number };
  };
}

/** The fields this reads off `agent-<id>.meta.json`. */
interface SubagentMeta {
  agentType?: unknown;
  description?: unknown;
  toolUseId?: unknown;
  finished?: unknown;
}

/** What one transcript says about the card it belongs to. */
interface TranscriptFacts {
  task: string | null;
  model: string | null;
  startedAt: string | null;
  elapsedMs: number | null;
  out: number;
  /** The `stop_reason` of its last response, or null. */
  lastStop: string | null;
  /** Every `tool_use` id it made a call under. */
  calls: string[];
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
  out: 0,
  lastStop: null,
  calls: [],
  badLines: 0,
};

/** A content block of type `type`, as a transcript's `message.content`
 *  holds them. */
const isBlock = <T extends object>(
  b: unknown,
  type: string,
): b is { type: string } & T =>
  typeof b === "object" &&
  b !== null &&
  (b as { type?: unknown }).type === type;

/** A prompt's first non-empty line, or null for a record that is not one. */
function promptText(rec: TranscriptRecord): string | null {
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
  const line = text
    ?.split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return line ?? null;
}

function toolCalls(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((b: unknown) =>
    isBlock<{ id: unknown }>(b, "tool_use") && typeof b.id === "string"
      ? [b.id]
      : [],
  );
}

/**
 * What a transcript's text says. An unparseable line is skipped, as the Usage
 * scan skips one, and counted unless it is the unterminated last line: the
 * files are append-only JSONL, and a half-written last line is their ordinary
 * state while a session works, where a bad line above it is a file the page
 * can't fully read.
 */
function factsOf(text: string): TranscriptFacts {
  let task: string | null = null;
  let model: string | null = null;
  let first: string | null = null;
  let firstMs = Infinity;
  let lastMs = -Infinity;
  let lastStop: string | null = null;
  const calls: string[] = [];
  /** Output per response id; a record with no id is its own response. */
  const byId = new Map<string, number>();
  let unkeyed = 0;
  let badLines = 0;

  const lines = text.split("\n");
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    let rec: TranscriptRecord;
    try {
      rec = JSON.parse(line) as TranscriptRecord;
    } catch {
      if (index < lines.length - 1) badLines++;
      continue;
    }
    if (typeof rec !== "object" || rec === null) continue;

    if (rec.timestamp) {
      const ms = Date.parse(rec.timestamp);
      if (!Number.isNaN(ms)) {
        if (ms < firstMs) {
          firstMs = ms;
          first = rec.timestamp;
        }
        lastMs = Math.max(lastMs, ms);
      }
    }

    task ??= promptText(rec);

    const message = rec.message;
    if (!message) continue;
    calls.push(...toolCalls(message.content));
    if (!model && message.model && message.model !== SYNTHETIC_MODEL) {
      model = message.model;
    }
    const usage = message.usage;
    if (!usage) continue;
    // Every block of a response carries the same `stop_reason`, the last
    // one written being the final word.
    lastStop = message.stop_reason ?? null;
    const out = usage.output_tokens ?? 0;
    if (message.id) {
      byId.set(message.id, Math.max(byId.get(message.id) ?? 0, out));
    } else {
      unkeyed += out;
    }
  }

  let out = unkeyed;
  for (const n of byId.values()) out += n;
  return {
    task,
    model,
    startedAt: first,
    elapsedMs: first !== null && lastMs > firstMs ? lastMs - firstMs : null,
    out,
    lastStop,
    calls,
    badLines,
  };
}

/**
 * An I/O error as its code (`EACCES`), never its message: Node's message
 * carries the absolute path, which spells `agent-<id>` in a word the page
 * must not use (R12) and repeats the file the warning already names.
 */
const errorText = (err: unknown) =>
  (err as NodeJS.ErrnoException | null)?.code ??
  (err instanceof Error ? err.message : String(err));

const isMissing = (err: unknown) =>
  (err as NodeJS.ErrnoException | null)?.code === "ENOENT";

/** A card plus the calls its transcript made, which only the linking reads. */
interface TreeNode {
  card: SessionCard;
  calls: string[];
}

const byStart = (a: SessionCard, b: SessionCard) =>
  (a.startedAt ?? "").localeCompare(b.startedAt ?? "");

const anyRunning = (cards: SessionCard[]): boolean =>
  cards.some(
    (c) => c.state === SESSION_STATE.running || anyRunning(c.children),
  );

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
  out: facts.out,
});

/** One session's tree, or a warning and null when its transcript can't be read. */
async function readSession(
  dir: string,
  id: string,
  warnings: SessionsWarning[],
): Promise<SessionCard | null> {
  const file = `${id}${TRANSCRIPT_SUFFIX}`;
  let facts: TranscriptFacts;
  try {
    facts = factsOf(await readFile(join(dir, file), "utf8"));
  } catch (err) {
    warnings.push({
      file,
      message: `Couldn't read this session's transcript (${errorText(err)}), so it is left out.`,
    });
    return null;
  }
  warnOfBadLines(file, facts, warnings);
  const root: TreeNode = {
    card: {
      id,
      subagentType: null,
      task: facts.task,
      ...cardFacts(facts),
      // Settled below, once its subagents are known.
      state: SESSION_STATE.running,
      children: [],
    },
    calls: facts.calls,
  };

  const subagents = await readSubagents(dir, id, warnings);
  const nodes = [root, ...subagents.map((s) => s.node)];
  const callers = new Map<string, TreeNode>();
  for (const node of nodes) {
    for (const call of node.calls) callers.set(call, node);
  }
  for (const { node, toolUseId, metaFile } of subagents) {
    if (toolUseId === null) {
      root.card.children.push(node.card);
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
    parent.card.children.push(node.card);
  }
  for (const node of nodes) node.card.children.sort(byStart);

  root.card.state =
    facts.lastStop === END_TURN && !anyRunning(root.card.children)
      ? SESSION_STATE.done
      : SESSION_STATE.running;
  return root.card;
}

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

/** Every subagent of one session that has a usable meta file. */
async function readSubagents(
  dir: string,
  sessionId: string,
  warnings: SessionsWarning[],
): Promise<SubagentNode[]> {
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
    return [];
  }

  const nodes: SubagentNode[] = [];
  for (const name of names.sort()) {
    const agentId = META_FILE.exec(name)?.[1];
    if (!agentId) continue;
    const metaFile = `${rel}/${name}`;
    let meta: SubagentMeta;
    try {
      meta = JSON.parse(
        await readFile(join(abs, name), "utf8"),
      ) as SubagentMeta;
    } catch (err) {
      warnings.push({
        file: metaFile,
        message: `Couldn't read this subagent's meta file (${errorText(err)}), so it is left out of the tree.`,
      });
      continue;
    }
    if (typeof meta !== "object" || meta === null) {
      warnings.push({
        file: metaFile,
        message:
          "Couldn't read this subagent's meta file: it holds no object, so it is left out of the tree.",
      });
      continue;
    }

    const transcript = name.slice(0, -META_SUFFIX.length) + TRANSCRIPT_SUFFIX;
    let facts = NO_FACTS;
    try {
      facts = factsOf(await readFile(join(abs, transcript), "utf8"));
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
          state:
            meta.finished === true ? SESSION_STATE.done : SESSION_STATE.running,
          children: [],
        },
        calls: facts.calls,
      },
      toolUseId: typeof meta.toolUseId === "string" ? meta.toolUseId : null,
      metaFile,
    });
  }
  return nodes;
}

/**
 * Every session in `dir` as a tree of cards, most recently started first, with
 * a warning for each file it could not use.
 *
 * A directory that does not exist is an empty reading rather than a warning:
 * it is the ordinary state of a clone Claude Code has never opened, and the
 * page's empty state names the directory it looked in.
 */
export async function readSessions(dir: string): Promise<SessionsReport> {
  const warnings: SessionsWarning[] = [];
  const sessions: SessionCard[] = [];
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
  for (const name of names.sort()) {
    if (!name.endsWith(TRANSCRIPT_SUFFIX)) continue;
    const card = await readSession(
      dir,
      name.slice(0, -TRANSCRIPT_SUFFIX.length),
      warnings,
    );
    if (card) sessions.push(card);
  }
  sessions.sort((a, b) => byStart(b, a));
  return {
    transcriptDir: dir,
    gatheredAt: new Date().toISOString(),
    sessions,
    warnings,
  };
}
