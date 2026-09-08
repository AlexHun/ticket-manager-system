import { readFileSync } from "node:fs";
import type { KbArticle } from "../ai/knowledge-base";
import { parseKnowledgeBaseMarkdown } from "../knowledge-base-import";

/**
 * The frozen corpus: `apps/api/knowledge-base.md`, read as data.
 *
 * The whole point of a frozen corpus is that a run's numbers move when the
 * *code* moves and at no other time. The `knowledge_article` table cannot do
 * that — an admin edits it, which is what it is for — so a red run against the
 * live corpus is ambiguous between a prompt regression and somebody rewording
 * an article, and the two look identical from a chart. The seed file is already
 * in the repository, already reviewed in pull requests, and already the thing a
 * fresh deployment starts from, so it is the version of the knowledge base that
 * a diff can explain.
 *
 * **Read through the same parser the seed uses**, not a second one. If the two
 * disagreed, the corpus this measures and the corpus a fresh deployment gets
 * would be different knowledge bases wearing the same filename.
 *
 * The `autoReply: true` filter and the shape of `KbArticle` reproduce the two
 * structural safety properties `autoReplyArticles()` has, and reproduce them the
 * same way rather than by remembering to: a withheld article is **absent** from
 * the returned array, and `internalNote` is dropped on the way out, so an eval
 * cannot measure a prompt that the live path would never build.
 *
 * `orderBy` is the file's own order, which is `KB-001`, `KB-002`, … — the same
 * ascending-id order `knowledge-base.ts` pins for OpenAI's prompt caching. Do
 * not sort this differently: a run's whole value in slice 2 is repeating one
 * case five times against an identical prefix, and reshuffling the corpus would
 * turn every repeat into a cache miss (see `ai-features.md` on `cached=`).
 */

/**
 * Where the seed file lives, relative to this module.
 *
 * Resolved against `import.meta.url` rather than `process.cwd()`, exactly as
 * `knowledge-base-import.ts` resolves it and for the same reason: this is
 * reached from the API process started in `apps/api` and from `bun test` run
 * anywhere, and a cwd-relative path works in one of those.
 */
const KB_PATH = new URL("../../knowledge-base.md", import.meta.url);

/**
 * Parsed once, on first use, and kept.
 *
 * A cache here is the opposite of the mistake `ai/knowledge-base.ts` refuses to
 * make. That module must not cache, because the table behind it is edited at
 * `/knowledge` and an edit that needs a restart to take effect is the worst
 * possible failure for that screen. This one reads a file that cannot change
 * while the process runs, and "frozen" is the property being asserted — so
 * re-reading it per case would buy nothing and risk a run whose first case and
 * last case answered different corpora.
 */
let cached: KbArticle[] | undefined;

export function frozenCorpus(): KbArticle[] {
  cached ??= parseKnowledgeBaseMarkdown(readFileSync(KB_PATH, "utf8"))
    .filter((article) => article.autoReply)
    .map(({ id, title, category, body }) => ({ id, title, category, body }));

  return cached;
}
