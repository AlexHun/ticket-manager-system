import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { KNOWLEDGE_ARTICLE_MARKER, STUB_PORT } from "./constants";

/**
 * A fake OpenAI Responses API, for exactly the two shapes of call this app's
 * AI features make — nothing else.
 *
 * Why this exists at all: `.env.test` deliberately carries no `OPENAI_API_KEY`
 * (see its own comment — a test run must not spend money or depend on the
 * network), which means the ordinary E2E server never runs classification or
 * the knowledge-base auto-reply. Issue #26 needs those real, unattended code
 * paths — `jobs/classify-ticket.ts`, `jobs/auto-reply-ticket.ts`,
 * `ai/auto-reply.ts`'s six safety checks — actually running, not mocked out at
 * the module boundary the way the API's own `bun test` suite mocks them. This
 * process is what lets a *second*, AI-enabled API instance (`.env.test.ai`,
 * `PORT=3003`) call something that looks enough like OpenAI to satisfy the
 * `ai` SDK's response parser, while spending nothing and reaching no real
 * network. See `apps/api/src/ai/provider.ts`'s `OPENAI_BASE_URL`.
 *
 * Deliberately narrow: it does not attempt to emulate the OpenAI API in
 * general, only `POST /responses` with the exact request shape
 * `generateText({ output: Output.object(...) })` produces against the
 * Responses API — verified by reading
 * `apps/api/node_modules/@ai-sdk/openai/dist/index.js` directly rather than
 * assumed from documentation, because the shape is small but exact:
 *
 *   - the schema the caller asked for lives at `body.text.format.schema`
 *     (*not* nested under a `json_schema` key — that was the first assumption
 *     that turned out wrong when checked against the actual request-building
 *     code, `getArgs()` around line 6368 of that file);
 *   - the two call sites are told apart by which properties that schema
 *     declares — `category` for `classify.ts`'s `classificationSchema`,
 *     `answered`/`articleIds`/`paragraphs`/`steps` for `auto-reply.ts`'s
 *     `autoReplySchema`;
 *   - the prompt's messages arrive as `body.input`, an array of
 *     `{ role, content }`, where `content` is a plain string for the system
 *     message (no cache-breakpoint provider option is set by either feature,
 *     so the SDK never wraps it in the array form it uses when one is) — and
 *     that message's `role` is `"developer"`, not `"system"`, because
 *     `gpt-5-nano` is a reasoning model and the Responses API maps a system
 *     prompt to the `developer` role for those. This one was not found by
 *     reading the source ahead of time; it showed up as every auto-reply
 *     declining with `notCovered` until a debug dump of a live request caught
 *     it. `systemMessageText` below accepts either role for that reason;
 *   - the response must satisfy `openaiResponsesResponseSchema` — one
 *     `output` entry of `type: "message"` whose `content` holds one
 *     `type: "output_text"` part, `annotations` present (required, not
 *     nullish) even when empty.
 */

interface OpenAIResponsesRequestBody {
  input?: Array<{ role: string; content: unknown }>;
  text?: { format?: { schema?: { properties?: Record<string, unknown> } } };
}

/** A system or user message's content, however the SDK chose to shape it. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && "text" in part
          ? String((part as { text: unknown }).text)
          : "",
      )
      .join("\n");
  }
  return "";
}

/**
 * `generateText`'s `system` prompt arrives here as `role: "developer"`, not
 * `role: "system"` — verified against a live request rather than assumed:
 * `gpt-5-nano` is a reasoning model, and the Responses API maps a system
 * message to the `developer` role for those (`systemMessageMode` in
 * `@ai-sdk/openai/dist/index.js`, `case "developer"`, right beside the
 * `case "system"` branch a non-reasoning model would take). Accepting either
 * keeps this working if a future model change moves it back.
 */
function systemMessageText(body: OpenAIResponsesRequestBody): string {
  const system = body.input?.find(
    (message) => message.role === "developer" || message.role === "system",
  );
  return system ? textOf(system.content) : "";
}

interface CorpusEntry {
  id: string;
  body: string;
}

/**
 * Pull `{id, body}` back out of `corpusBlock()` in `ai/auto-reply.ts`, which
 * wrote `[KB-xxx] (category) title\nbody`, one article per block, separated by
 * blank lines, wrapped in "THE KNOWLEDGE BASE:" / "END OF THE KNOWLEDGE BASE."
 * banners this suite's synthetic bodies are never designed to contain.
 */
function parseCorpus(systemText: string): CorpusEntry[] {
  const entries: CorpusEntry[] = [];
  const pattern =
    /\[(KB-\d+)\] \([^)]*\) [^\n]*\n([\s\S]*?)(?=\n\n\[KB-\d+\]|\n\nEND OF THE KNOWLEDGE BASE|$)/g;

  for (const match of systemText.matchAll(pattern)) {
    entries.push({ id: match[1]!, body: match[2]!.trim() });
  }
  return entries;
}

function respondWithMessage(res: ServerResponse, text: string): void {
  const payload = {
    id: "resp_stub_1",
    created_at: 0,
    model: "gpt-5-nano",
    output: [
      {
        type: "message",
        role: "assistant",
        id: "msg_stub_1",
        content: [{ type: "output_text", text, annotations: [] }],
      },
    ],
    usage: { input_tokens: 100, output_tokens: 50 },
  };
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * Classify's schema: `{ category: enum }`. Always answers `General` —
 * deterministic, and `General` is one of `auto-reply-ticket.ts`'s
 * `ANSWERABLE_CATEGORIES`, which is what lets a ticket reach the auto-reply at
 * all.
 */
function classifyResponse(): string {
  return JSON.stringify({ category: "General" });
}

/**
 * Auto-reply's schema: `{ answered, articleIds, paragraphs, steps }`. Answers
 * from whichever corpus article carries `KNOWLEDGE_ARTICLE_MARKER` and has the
 * highest id — see that constant's own comment for why "highest id" rather
 * than "the marked one": nothing in this app deletes a `KnowledgeArticle`, so
 * a corpus built across repeated runs of this spec can hold several marked
 * articles, and ids are assigned in increasing order and never reused.
 *
 * Echoing the article's body back verbatim, rather than writing an answer of
 * its own, is deliberate and does two jobs at once: it trivially passes every
 * one of `ai/auto-reply.ts`'s checks 4-6 (the citation exists, and nothing
 * appears in the reply that its own cited source did not already contain),
 * and it is exactly the signal the test needs — telling "the old article
 * text" and "the new article text" apart in the finished customer-facing
 * message is the entire point of issue #26.
 */
function autoReplyResponse(systemText: string): string {
  const corpus = parseCorpus(systemText);
  const marked = corpus.filter((entry) => entry.body.includes(KNOWLEDGE_ARTICLE_MARKER));
  const chosen = marked.sort((a, b) => (a.id > b.id ? -1 : 1))[0];

  if (!chosen) {
    // No marked article in the prompt — decline, matching what a real corpus
    // with nothing relevant would produce. Should not happen once the spec has
    // created its fixture article, and declining rather than guessing keeps a
    // setup mistake visible as a failed assertion downstream instead of a
    // reply that cites the wrong thing.
    return JSON.stringify({
      answered: false,
      articleIds: [],
      paragraphs: null,
      steps: null,
    });
  }

  return JSON.stringify({
    answered: true,
    articleIds: [chosen.id],
    paragraphs: [chosen.body],
    steps: null,
  });
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${STUB_PORT}`);

  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  if (req.method !== "POST" || url.pathname !== "/responses") {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
    return;
  }

  void readBody(req).then((raw) => {
    let body: OpenAIResponsesRequestBody;
    try {
      body = JSON.parse(raw) as OpenAIResponsesRequestBody;
    } catch {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("invalid JSON");
      return;
    }

    const properties = body.text?.format?.schema?.properties ?? {};
    const text =
      "category" in properties
        ? classifyResponse()
        : autoReplyResponse(systemMessageText(body));

    respondWithMessage(res, text);
  });
});

server.listen(STUB_PORT, () => {
  console.log(`[fake-openai] listening on http://localhost:${STUB_PORT}`);
});
