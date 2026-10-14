import type { TutorialStep } from "@ticket/shared";

/**
 * The starter walkthrough copy, one entry per `TutorialPageKey`, which
 * `prisma/seed-tutorials.ts` writes into `TutorialContent` on a fresh
 * deployment.
 *
 * It lives here rather than in the seed script so a test can read it: the
 * script runs its writes at import, and a deployment seeded before a rewording
 * keeps the old text until a data migration rewrites it. Such a migration
 * rewrites a step only where its stored text still equals the old copy, and
 * `tutorial-wording-migration.test.ts` checks that it lands on exactly this.
 */
export const TUTORIAL_STARTER_CONTENT: Record<
  string,
  { title: string; steps: TutorialStep[] }
> = {
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
        body: "Four numbers at a glance: the Backlog, created, settled, and median first reply — each links to the tickets behind it.",
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
        body: "Search, status, category and assignee — combine them, or use the Mine and Unassigned shortcuts for your own tickets or the ones nobody has taken.",
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
        body: "Generate a fresh read of the ticket and its thread — sentiment, key points, and a suggested next step. Every click re-reads the thread, so regenerate after a new reply comes in.",
        anchor: "summary",
      },
      {
        title: "The thread",
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
        body: "Send a simulated ticket and watch it move through the rail in real time.",
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
        body: "Invite a new agent — they'll get an email to set their own password. To make them an admin, edit their account once it's there.",
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
    title: "Every email the desk writes",
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
  // Every step here says something the screen cannot say for itself, which is
  // why this page was the one that most needed a walkthrough (#240): a rate is
  // never a pass, the two corpora are never averaged, "Failing" is not
  // "Failed", and a run spends real money while touching no ticket. All of
  // that was explained only in code comments before this.
  evals: {
    title: "Measuring the unattended path",
    steps: [
      {
        title: "What a run is",
        body: "Every case whose outcome is written down, answered five times each against the real provider. It spends real money — and it touches nothing: no ticket, no message, no email. Nothing on an agent's screen moves while one runs.",
        anchor: "run",
      },
      {
        title: "Which corpus",
        body: 'One control, doing two jobs: it filters the runs below and aims the Run button, so what you are reading and what you are about to start are always the same series. There is deliberately no "all" — a frozen run and a live run are two series and are never averaged. Frozen moves only when the code does; live answers from the articles admins are editing.',
        anchor: "corpus",
      },
      {
        title: "Failing is not Failed",
        body: 'Two different pieces of news, an inch apart. "Failed" is the run falling over — the provider was unreachable — and it has no numbers. "Failing" is a run that finished and whose rates came in under what they were declared to need. That second one is the answer this page exists to give.',
        anchor: "status",
      },
      {
        title: "Reading the headline rates",
        body: "Each is a rate over repeats, never a pass, and each carries its own denominator because they count different things — the catch rate only over the repeats that actually planted a payload. They are judged against the threshold the run itself recorded, so an old run keeps saying what it was measured against.",
        anchor: "metrics",
      },
      {
        title: "Case by case",
        body: "Open this for the per-case rows. A case that split 3 of 5 is the finding, not a failure: five answers from a model that disagree with each other is exactly what one answer reported as a fact would have hidden. An escaped payload is the one thing here that is a defect rather than a measurement.",
        anchor: "cases",
      },
    ],
  },
};
