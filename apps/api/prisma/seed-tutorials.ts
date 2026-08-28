import { TUTORIAL_PAGE_KEYS, type TutorialStep } from "@ticket/shared";
import { prisma } from "../src/db";

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
 */
const CONTENT: Record<string, { title: string; steps: TutorialStep[] }> = {
  dashboard: {
    title: "Reading the dashboard",
    steps: [
      {
        title: "Time range and scope",
        body: "Every panel below follows this range and this scope — change it here and the whole page updates together.",
        anchor: "range",
      },
      {
        title: "The stat row",
        body: "Four numbers at a glance: open backlog, created, settled, and median first reply — each links to the tickets behind it.",
        anchor: "kpis",
      },
      {
        title: "How the assistant is doing",
        body: "Auto-replied, declined, and overridden counts, plus why the assistant declined when it did — this is where to check if it's behaving.",
        anchor: "assistant",
      },
    ],
  },
  tickets: {
    title: "Working the ticket list",
    steps: [
      {
        title: "Filters",
        body: "Search, status, category and assignee — combine them, or use the Mine/Unassigned shortcuts for your own queue.",
        anchor: "filters",
      },
      {
        title: "The ticket table",
        body: "Click a column header to sort, drag a column's edge to resize it, and click a row to open the ticket.",
        anchor: "table",
      },
      {
        title: "Row density",
        body: "Switch to compact rows to see more of the list at once.",
        anchor: "density",
      },
    ],
  },
  ticketDetail: {
    title: "Inside a ticket",
    steps: [
      {
        title: "Status, category, assignee",
        body: "Change any of these directly from here — no need to leave the ticket.",
        anchor: "fields",
      },
      {
        title: "AI summary",
        body: "Generate a fresh read of the ticket and its thread — sentiment, key points, and a suggested next step. Every click re-reads the conversation, so regenerate after a new reply comes in.",
        anchor: "summary",
      },
      {
        title: "The conversation",
        body: "Every message with the customer, plus activity like status changes and handoffs, in one thread.",
        anchor: "thread",
      },
      {
        title: "Replying",
        body: "Write your reply here, then send it — or Send & resolve to close the ticket in the same click.",
        anchor: "reply",
      },
      {
        title: "Polish",
        body: "Started a draft but not happy with the wording? Polish rewrites it as a reply to the customer — it needs a few words to work from, and Undo puts back what you had.",
        anchor: "polish",
      },
    ],
  },
  pipeline: {
    title: "How tickets move on their own",
    steps: [
      {
        title: "Whether it's running",
        body: "Four facts about whether classification and auto-reply are live right now — if the rail below looks empty, check here first.",
        anchor: "config",
      },
      {
        title: "The rail",
        body: "Every stage a ticket passes through on its way in, and how many are moving through each one.",
        anchor: "rail",
      },
      {
        title: "Try it",
        body: "Send a test email through the pipeline and watch it move through the rail in real time.",
        anchor: "simulator",
      },
    ],
  },
  knowledge: {
    title: "What the desk knows",
    steps: [
      {
        title: "What the assistant can say",
        body: "This is the one number that matters: how many live articles the auto-reply may answer from unattended.",
        anchor: "answerable",
      },
      {
        title: "Adding an article",
        body: "Write one here — it can answer agents' questions immediately, and won't reach a customer unattended until you turn its auto-reply switch on.",
        anchor: "new",
      },
    ],
  },
  users: {
    title: "Who can sign in",
    steps: [
      {
        title: "Everyone who can sign in",
        body: "Admins and agents, and the automated assistant account that shows up on tickets it handles.",
        anchor: "list",
      },
      {
        title: "Adding someone",
        body: "Invite a new admin or agent — they'll get an email to set their password.",
        anchor: "new",
      },
    ],
  },
  activity: {
    title: "The audit trail",
    steps: [
      {
        title: "Filtering the feed",
        body: "Narrow by entity type, actor, or date range to find one change.",
        anchor: "filters",
      },
      {
        title: "The feed",
        body: "Every recorded change across tickets, the knowledge base, accounts and automation — newest first.",
        anchor: "feed",
      },
    ],
  },
  outbox: {
    title: "Every email the desk sent",
    steps: [
      {
        title: "Filter by status",
        body: "Every email the desk has written — filter down to just the ones that failed or are still pending.",
        anchor: "status",
      },
      {
        title: "One email",
        body: "Open a row to see the full message; a failed or undeliverable one can be retried from here.",
        anchor: "rows",
      },
    ],
  },
};

const inserted: string[] = [];
const skipped: string[] = [];

for (const pageKey of TUTORIAL_PAGE_KEYS) {
  const content = CONTENT[pageKey];
  if (!content) {
    throw new Error(`No seed content for tutorial page "${pageKey}"`);
  }

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

console.log(`[seed-tutorials] ${inserted.length} page(s) seeded, ${skipped.length} already had content`);
if (inserted.length > 0) {
  console.log(`[seed-tutorials] inserted: ${inserted.join(", ")}`);
}
if (skipped.length > 0) {
  console.log(`[seed-tutorials] left untouched: ${skipped.join(", ")}`);
}

await prisma.$disconnect();
