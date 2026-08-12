import { readFileSync } from "node:fs";
import { TICKET_CATEGORY, type TicketCategory } from "@ticket/shared";

/**
 * Reading `apps/api/knowledge-base.md` into something a prompt can be built from.
 *
 * The knowledge base is a markdown file rather than the `knowledge_articles`
 * table `implementation-plan.md` Phase 5 assumed, and that is a deliberate fork:
 * a file is reviewable in a pull request, diffable, and cannot be edited by
 * anyone who has talked their way into an admin session. Since editing an
 * article changes what the desk tells customers with no human in the loop, being
 * able to see who changed it and when is worth more than an admin CRUD screen.
 * A table can come later; it should come with an audit log.
 *
 * Two things happen here that are not parsing, and both are load-bearing:
 *
 * **`> Internal:` blocks are dropped.** They are the notes that tell a person
 * what not to promise and when to escalate, and they are the one part of an
 * article a customer must never see. The prompt could be asked not to quote
 * them; asking is what this repo has repeatedly measured as unreliable. Removing
 * them here means the auto-reply cannot leak what it was never shown, which is a
 * property rather than a hope.
 *
 * **`Auto-reply: no` articles are withheld.** The flag is the knowledge base's
 * own control over what a machine may answer unattended, and it is applied by
 * `autoReplyArticles()` rather than by the prompt, so a `no` article is not
 * "discouraged" — it is absent.
 */

/**
 * Where the file lives, relative to this module.
 *
 * Resolved against `import.meta.url` rather than `process.cwd()`: the API is
 * started from `apps/api` in development, from the repo root by some scripts,
 * and from wherever a host feels like in production. A cwd-relative path works
 * in exactly the first case and fails silently — as an empty knowledge base —
 * in the others, which is the worst possible failure mode for this file.
 */
const KB_PATH = new URL("../../knowledge-base.md", import.meta.url);

/** `### KB-001 — I forgot my password` */
const HEADING = /^### (KB-\d{3}) — (.+)$/;

/** `**Category:** Technical · **Auto-reply:** yes` */
const META = /^\*\*Category:\*\* (\w+) · \*\*Auto-reply:\*\* (yes|no)$/;

/** A blockquote note for staff. Never leaves this module. */
const INTERNAL = /^>\s*Internal:/i;

/** Any other blockquote line, i.e. the continuation of an internal note. */
const QUOTE = /^>/;

export interface KbArticle {
  /** `KB-001`. Stable, never reused, and what a reply cites. */
  id: string;
  /** The question, phrased as a customer would ask it. */
  title: string;
  category: TicketCategory;
  /** The answer, with every internal note already removed. */
  body: string;
}

/**
 * Turn the markdown into articles.
 *
 * Line-oriented and deliberately strict: an article only counts if it has a
 * heading, a well-formed metadata line and a body. A malformed one is skipped
 * with a warning rather than half-parsed, because a half-parsed article is an
 * article the model will answer from with a fact missing from it.
 */
function parse(markdown: string): { articles: KbArticle[]; autoReply: Set<string> } {
  const articles: KbArticle[] = [];
  const autoReply = new Set<string>();

  let id: string | null = null;
  let title = "";
  let category: TicketCategory | null = null;
  let flag = false;
  let body: string[] = [];

  const flush = () => {
    if (id === null) return;
    const text = body.join("\n").trim();
    if (category === null || text.length === 0) {
      console.warn(`[kb] skipping ${id}: no category line or no body`);
    } else {
      articles.push({ id, title, category, body: text });
      if (flag) autoReply.add(id);
    }
    id = null;
    title = "";
    category = null;
    flag = false;
    body = [];
  };

  // Everything before the first `###` heading is the file's own preamble — the
  // authoring rules and the trust notes. It is guidance for people writing
  // articles, not an answer to anybody's question, so it never reaches a prompt.
  let inInternal = false;

  for (const line of markdown.split("\n")) {
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      id = heading[1]!;
      title = heading[2]!.trim();
      inInternal = false;
      continue;
    }

    if (id === null) continue;

    // A `##` section heading between articles ends the one above it.
    if (line.startsWith("## ") || line.startsWith("---")) {
      flush();
      inInternal = false;
      continue;
    }

    const meta = META.exec(line);
    if (meta) {
      const value = meta[1]!;
      category = isCategory(value) ? value : null;
      if (category === null) console.warn(`[kb] ${id}: unknown category "${value}"`);
      flag = meta[2] === "yes";
      continue;
    }

    // An internal note runs until the blockquote stops, so a two-line note loses
    // both lines. Checking only the first would leave the second in the body,
    // stripped of the marker that said what it was — the worst of both.
    if (INTERNAL.test(line)) {
      inInternal = true;
      continue;
    }
    if (inInternal) {
      if (QUOTE.test(line) || line.trim().length === 0) continue;
      inInternal = false;
    }

    body.push(line);
  }

  flush();
  return { articles, autoReply };
}

function isCategory(value: string): value is TicketCategory {
  return Object.hasOwn(TICKET_CATEGORY, value);
}

/**
 * Read and parse once, on first use.
 *
 * Cached because the file cannot change under a running process in any
 * deployment this repo has — it ships with the code — and re-reading it per
 * ticket would be a synchronous file read on a worker for no gain. It is *not*
 * read at import: a module that throws or does I/O at import takes down every
 * test and every script that transitively touches it, and this one is imported
 * by the job layer.
 */
let cache: { articles: KbArticle[]; autoReply: Set<string> } | undefined;

function load(): { articles: KbArticle[]; autoReply: Set<string> } {
  if (cache) return cache;

  let markdown: string;
  try {
    markdown = readFileSync(KB_PATH, "utf8");
  } catch (err) {
    // Not fatal, and not silent. An absent knowledge base disables the
    // auto-reply and changes nothing else — the same stance `isAiConfigured()`
    // takes on a missing key — but it has to be loud, because the symptom
    // otherwise is a support desk that has quietly stopped answering anything.
    console.error(`[kb] could not read ${KB_PATH.pathname}:`, err);
    cache = { articles: [], autoReply: new Set() };
    return cache;
  }

  cache = parse(markdown);
  console.log(
    `[kb] ${cache.articles.length} article(s), ${cache.autoReply.size} available to the auto-reply`,
  );
  return cache;
}

/** Every article, internal notes removed. */
export function allArticles(): KbArticle[] {
  return load().articles;
}

/**
 * The articles a machine may answer from: `Auto-reply: yes`, internal notes
 * already gone.
 *
 * An empty result disables the feature, which is what a missing or unparseable
 * file produces. Callers check it rather than assuming a corpus exists.
 */
export function autoReplyArticles(): KbArticle[] {
  const { articles, autoReply } = load();
  return articles.filter((article) => autoReply.has(article.id));
}

/**
 * Look an id up among the auto-replyable articles.
 *
 * Scoped to those on purpose: this is what validates a citation, and an answer
 * citing an article the model was never given is not a citation, it is a
 * hallucinated one that happens to match a real id.
 */
export function autoReplyArticleById(id: string): KbArticle | undefined {
  return autoReplyArticles().find((article) => article.id === id);
}
