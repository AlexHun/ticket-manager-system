import { readFileSync } from "node:fs";
import {
  KNOWLEDGE_REVISION_ACTION,
  TICKET_CATEGORY,
  type TicketCategory,
} from "@ticket/shared";
import { prisma } from "./db";

/**
 * Importing `apps/api/knowledge-base.md` into the `knowledge_article` table.
 *
 * The markdown file used to *be* the knowledge base, parsed at boot by
 * `ai/knowledge-base.ts`. It is now the seed corpus: the thing a fresh
 * deployment starts from, and the reference for what an article should look
 * like. Nothing reads it at runtime, so this module is only reached by
 * `prisma/seed-knowledge-base.ts`.
 *
 * It lives in `src` rather than beside that script because `apps/api/tsconfig`
 * only includes `src` — and this is the code that decides what text ends up in
 * an unattended reply's prompt, which is the last thing that should be running
 * unchecked.
 *
 * **Idempotent, and one-directional.** An article already in the table is left
 * exactly as it is, including its `autoReply` flag. That matters more than it
 * looks: re-running the seed after an admin has withheld an article must not put
 * it back in front of the machine. The file is where articles come *from*, never
 * something the database is reconciled *against*.
 */

/** `### KB-001 — I forgot my password` */
const HEADING = /^### (KB-\d{3}) — (.+)$/;

/** `**Category:** Technical · **Auto-reply:** yes` */
const META = /^\*\*Category:\*\* (\w+) · \*\*Auto-reply:\*\* (yes|no)$/;

/** A blockquote note for staff. */
const INTERNAL = /^>\s*Internal:/i;

/** Any other blockquote line, i.e. the continuation of an internal note. */
const QUOTE = /^>/;

export interface ImportedArticle {
  id: string;
  title: string;
  category: TicketCategory;
  body: string;
  /** The `> Internal:` lines, joined, with the markers removed. Null when none. */
  internalNote: string | null;
  autoReply: boolean;
}

function isCategory(value: string): value is TicketCategory {
  return Object.hasOwn(TICKET_CATEGORY, value);
}

/**
 * Turn the markdown into articles.
 *
 * Line-oriented and deliberately strict: an article only counts if it has a
 * heading, a well-formed metadata line and a body. A malformed one is skipped
 * with a warning rather than half-parsed, because a half-parsed article is an
 * article the model will answer from with a fact missing from it.
 *
 * The one change from the version this replaces: internal notes are **kept**,
 * in a field of their own, instead of being dropped on the floor. The old parser
 * fed a prompt directly and had to destroy them; this one feeds a table whose
 * `internalNote` column is simply never selected into a prompt. Same guarantee,
 * and the notes survive for the people they were written for.
 */
export function parseKnowledgeBaseMarkdown(markdown: string): ImportedArticle[] {
  const articles: ImportedArticle[] = [];

  let id: string | null = null;
  let title = "";
  let category: TicketCategory | null = null;
  let autoReply = false;
  let body: string[] = [];
  let internal: string[] = [];

  const flush = () => {
    if (id === null) return;
    const text = body.join("\n").trim();
    if (category === null || text.length === 0) {
      console.warn(`[kb-import] skipping ${id}: no category line or no body`);
    } else {
      const note = internal.join("\n").trim();
      articles.push({
        id,
        title,
        category,
        body: text,
        internalNote: note.length > 0 ? note : null,
        autoReply,
      });
    }
    id = null;
    title = "";
    category = null;
    autoReply = false;
    body = [];
    internal = [];
  };

  // Everything before the first `###` heading is the file's own preamble — the
  // authoring rules and the trust notes. It is guidance for people writing
  // articles, not an answer to anybody's question, so it is not an article.
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
      if (category === null) console.warn(`[kb-import] ${id}: unknown category "${value}"`);
      autoReply = meta[2] === "yes";
      continue;
    }

    // An internal note runs until the blockquote stops, so a two-line note keeps
    // both lines together. Checking only the first would leave the second in the
    // body, stripped of the marker that said what it was — the worst of both.
    if (INTERNAL.test(line)) {
      inInternal = true;
      internal.push(line.replace(INTERNAL, "").trim());
      continue;
    }
    if (inInternal) {
      if (QUOTE.test(line)) {
        internal.push(line.replace(QUOTE, "").trim());
        continue;
      }
      if (line.trim().length === 0) continue;
      inInternal = false;
    }

    body.push(line);
  }

  flush();
  return articles;
}

/**
 * Where the seed file lives, relative to this module.
 *
 * Resolved against `import.meta.url` rather than `process.cwd()`: the seed is
 * run from `apps/api` by the package script and from the repo root by anyone
 * typing the path themselves, and a cwd-relative path works in exactly one of
 * those and fails as an empty import in the other.
 */
const KB_PATH = new URL("../knowledge-base.md", import.meta.url);

/** Who the import records as the author, since no admin is signed in for it. */
const IMPORT_EDITOR = "Import from knowledge-base.md";

export interface ImportResult {
  parsed: number;
  inserted: string[];
  skipped: string[];
}

/**
 * Insert every article the table does not already have.
 *
 * Each insert carries its `created` revision in the same transaction as the
 * article, which is the invariant the whole audit trail rests on: there is no
 * path anywhere in this codebase that puts a row in `knowledge_article` without
 * saying where it came from. The import is not an exception to that rule; it is
 * the first entry in the log.
 */
export async function importKnowledgeBase(): Promise<ImportResult> {
  const articles = parseKnowledgeBaseMarkdown(readFileSync(KB_PATH, "utf8"));

  const existing = new Set(
    (await prisma.knowledgeArticle.findMany({ select: { id: true } })).map(
      (row) => row.id,
    ),
  );

  const inserted: string[] = [];
  const skipped: string[] = [];

  for (const article of articles) {
    if (existing.has(article.id)) {
      skipped.push(article.id);
      continue;
    }

    // Destructured because the two models both have an `id` and they are not
    // the same thing: the article's is `KB-004`, the revision's is an
    // autoincrementing integer. Spreading the article whole would try to write
    // the string into the revision's primary key.
    const { id, ...fields } = article;

    await prisma.$transaction(async (tx) => {
      await tx.knowledgeArticle.create({ data: article });
      await tx.knowledgeArticleRevision.create({
        data: {
          ...fields,
          articleId: id,
          action: KNOWLEDGE_REVISION_ACTION.created,
          archived: false,
          editorId: null,
          editorName: IMPORT_EDITOR,
          editorEmail: null,
        },
      });
    });
    inserted.push(id);
  }

  return { parsed: articles.length, inserted, skipped };
}
