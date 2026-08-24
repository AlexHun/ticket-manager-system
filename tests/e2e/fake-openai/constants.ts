/**
 * Shared between the stub server and the spec that drives it, so the two
 * cannot drift apart silently.
 */

/**
 * Where the stub listens. `apps/api/.env.test.ai`'s `OPENAI_BASE_URL` must
 * point here, and `playwright.config.ts`'s `webServer` entry for the stub
 * must use the same number — none of those three files can import this one
 * (two are not TypeScript modules Playwright resolves at config-parse time
 * the same way), so this comment is the cross-check.
 */
export const STUB_PORT = 3999;

/**
 * Present in an article's body, `KNOWLEDGE_ARTICLE_MARKER` is how the stub
 * finds "the article this test run is about" inside a corpus that — because
 * nothing in this app ever deletes a `KnowledgeArticle` — also carries every
 * marked article any *earlier* run of this same spec left behind.
 *
 * That is not a hypothetical: `KB-xxx` ids are never reused (see
 * `nextArticleId` in `routes/knowledge.ts`), and there is no API route this
 * suite could call to remove a row afterwards even if it wanted to. So the
 * stub does not simply grab "the marked article" — see `server.ts` — it picks
 * the one with the *highest* id among the marked ones, because ids only ever
 * increase and the current run's article is always the newest.
 */
export const KNOWLEDGE_ARTICLE_MARKER = "E2E-AUTO-REPLY-MARKER";
