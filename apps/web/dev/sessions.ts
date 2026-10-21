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
}

const NO_FACTS: TranscriptFacts = {
  task: null,
  model: null,
  startedAt: null,
  elapsedMs: null,
  out: 0,
  lastStop: null,
  calls: [],
};

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
      (b: unknown): b is { type: "text"; text: string } =>
        typeof b === "object" &&
        b !== null &&
        (b as { type?: unknown }).type === "text" &&
        typeof (b as { text?: unknown }).text === "string",
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
    typeof b === "object" &&
    b !== null &&
    (b as { type?: unknown }).type === "tool_use" &&
    typeof (b as { id?: unknown }).id === "string"
      ? [(b as { id: string }).id]
      : [],
  );
}

/**
 * What a transcript's text says. An unparseable line is skipped, as the Usage
 * scan skips one: the files are append-only JSONL, and a half-written last
 * line is their ordinary state while a session works.
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

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let rec: TranscriptRecord;
    try {
      rec = JSON.parse(line) as TranscriptRecord;
    } catch {
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
  };
}

const errorText = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

const isMissing = (err: unknown) =>
  (err as NodeJS.ErrnoException | null)?.code === "ENOENT";

/** A card plus the calls its transcript made, which only the linking reads. */
interface Node {
  card: SessionCard;
  calls: string[];
}

const byStart = (a: SessionCard, b: SessionCard) =>
  (a.startedAt ?? "").localeCompare(b.startedAt ?? "");

const anyRunning = (cards: SessionCard[]): boolean =>
  cards.some(
    (c) => c.state === SESSION_STATE.running || anyRunning(c.children),
  );

/** One session's tree, or a warning and null when its transcript can't be read. */
async function readSession(
  dir: string,
  id: string,
  warnings: SessionsWarning[],
): Promise<SessionCard | null> {
  const file = `${id}.jsonl`;
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
  const { lastStop, calls, ...rest } = facts;
  const root: Node = {
    card: {
      id,
      subagentType: null,
      ...rest,
      // Settled below, once its subagents are known.
      state: SESSION_STATE.running,
      children: [],
    },
    calls,
  };

  const subagents = await readSubagents(dir, id, warnings);
  const callers = new Map<string, Node>();
  for (const node of [root, ...subagents.map((s) => s.node)]) {
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
  for (const node of [root, ...subagents.map((s) => s.node)]) {
    node.card.children.sort(byStart);
  }

  root.card.state =
    lastStop === "end_turn" && !anyRunning(root.card.children)
      ? SESSION_STATE.done
      : SESSION_STATE.running;
  return root.card;
}

interface SubagentNode {
  node: Node;
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
  const rel = `${sessionId}/${SUBAGENTS_DIR}`;
  let names: string[];
  try {
    names = await readdir(join(dir, sessionId, SUBAGENTS_DIR));
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
        await readFile(join(dir, sessionId, SUBAGENTS_DIR, name), "utf8"),
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

    const transcript = name.slice(0, -META_SUFFIX.length) + ".jsonl";
    let facts = NO_FACTS;
    try {
      facts = factsOf(
        await readFile(join(dir, sessionId, SUBAGENTS_DIR, transcript), "utf8"),
      );
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
          model: facts.model,
          startedAt: facts.startedAt,
          elapsedMs: facts.elapsedMs,
          out: facts.out,
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
export async function readSessions(
  dir: string,
  now: Date = new Date(),
): Promise<SessionsReport> {
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
    if (!name.endsWith(".jsonl")) continue;
    const card = await readSession(
      dir,
      name.slice(0, -".jsonl".length),
      warnings,
    );
    if (card) sessions.push(card);
  }
  sessions.sort((a, b) => byStart(b, a));
  return {
    transcriptDir: dir,
    gatheredAt: now.toISOString(),
    sessions,
    warnings,
  };
}
