import { prisma } from "../src/db";
import { importKnowledgeBase } from "../src/knowledge-base-import";

/**
 * Load `apps/api/knowledge-base.md` into the `knowledge_article` table.
 *
 * Run once on a fresh deployment (`bun run db:seed:kb`). Safe to run again: an
 * article whose id is already in the table is skipped whole, flag included, so
 * this can never undo an admin's decision to withhold something from the
 * machine. The parser and the insert live in `src/knowledge-base-import.ts`
 * where the typechecker can see them; this is only the entry point.
 */
const { parsed, inserted, skipped } = await importKnowledgeBase();

console.log(`[kb-import] parsed ${parsed} article(s) from knowledge-base.md`);
if (inserted.length > 0) {
  console.log(`[kb-import] inserted ${inserted.length}: ${inserted.join(", ")}`);
}
if (skipped.length > 0) {
  console.log(
    `[kb-import] left ${skipped.length} existing article(s) untouched: ${skipped.join(", ")}`,
  );
}

await prisma.$disconnect();
