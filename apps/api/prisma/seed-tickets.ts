/**
 * Demo ticket seeder — dev databases, and production only while it is a
 * showcase with no real customer mail (see SCRIPTS.md).
 *
 *   bun run db:seed:tickets            append any demo tickets not already there
 *   bun run db:seed:tickets --reset    replace the demo tickets with fresh ones
 *
 * A thin command line over `seedShowcase` in `src/demo/showcase.ts`, which the
 * nightly reset (`src/jobs/demo-reset.ts`) runs too — so `--reset` by hand and
 * the night put back exactly the same showcase (#323). Both modes leave
 * non-demo tickets untouched; rows are matched on subject + customer email.
 */
import { prisma } from "../src/db";
import { seedShowcase } from "../src/demo/showcase";

const seeded = await seedShowcase({ reset: process.argv.includes("--reset") });

if (seeded.removed > 0) {
  console.log(`Removed ${seeded.removed} existing demo ticket(s).`);
}
if (seeded.created === 0) {
  console.log("All demo tickets already present — nothing to add.");
} else {
  console.log(
    `Created ${seeded.created} demo ticket(s) and ${seeded.messages} message(s).`,
  );
}
if (seeded.backfilledTickets > 0) {
  console.log(
    `Backfilled ${seeded.backfilledMessages} message(s) onto ${seeded.backfilledTickets} existing demo ticket(s).`,
  );
}

const [total, byStatus, uncategorised, messages, threadless] =
  await Promise.all([
    prisma.ticket.count(),
    prisma.ticket.groupBy({ by: ["status"], _count: true }),
    prisma.ticket.count({ where: { category: null } }),
    prisma.message.count(),
    prisma.ticket.count({ where: { messages: { none: {} } } }),
  ]);

console.log(`Tickets in database: ${total}`);
console.log(
  `  by status: ${byStatus.map((g) => `${g.status}=${g._count}`).join(", ")}`,
);
console.log(`  uncategorised: ${uncategorised}`);
console.log(`Messages in database: ${messages}`);
console.log(`  tickets with no thread: ${threadless}`);

await prisma.$disconnect();
