import { TUTORIAL_PAGE_KEYS } from "@ticket/shared";
import { prisma } from "../src/db";
import { TUTORIAL_STARTER_CONTENT } from "../src/tutorial-starter-content";

/**
 * Write the starter walkthrough copy into `TutorialContent`, one row per
 * `TutorialPageKey`.
 *
 * Run once on a fresh deployment (`bun run db:seed:tutorials`). Same
 * skip-whole idempotency as `seed-knowledge-base.ts`: a page that already has
 * a row is left untouched, so this can never overwrite an admin's edits made
 * through `/`'s tutorial editor — re-running it after go-live is harmless.
 *
 * There is no other seed for this table on purpose (see `tutorials.ts`'s
 * `PUT /:pageKey`): content is normally admin-authored against whichever
 * database the app is pointed at, which is exactly why a fresh environment —
 * production included — starts with none until this runs once.
 *
 * The copy itself is `src/tutorial-starter-content.ts`.
 */
const inserted: string[] = [];
const skipped: string[] = [];

for (const pageKey of TUTORIAL_PAGE_KEYS) {
  const content = TUTORIAL_STARTER_CONTENT[pageKey];

  const existing = await prisma.tutorialContent.findUnique({
    where: { pageKey },
    select: { pageKey: true },
  });
  if (existing) {
    skipped.push(pageKey);
    continue;
  }

  await prisma.tutorialContent.create({
    data: {
      pageKey,
      title: content.title,
      steps: content.steps,
      updatedByName: "Seed script",
    },
  });
  inserted.push(pageKey);
}

console.log(
  `[seed-tutorials] ${inserted.length} page(s) seeded, ${skipped.length} already had content`,
);
if (inserted.length > 0) {
  console.log(`[seed-tutorials] inserted: ${inserted.join(", ")}`);
}
if (skipped.length > 0) {
  console.log(`[seed-tutorials] left untouched: ${skipped.join(", ")}`);
}

await prisma.$disconnect();
