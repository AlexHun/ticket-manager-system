/**
 * Demo ticket seeder — dev database only.
 *
 * Deliberately NOT part of `prisma/seed.ts`: that file also runs against the
 * test database via `db:test:seed`, where 100 extra rows would undermine the
 * E2E fixtures.
 *
 *   bun run db:seed:tickets            append any demo tickets not already there
 *   bun run db:seed:tickets --reset    delete the demo tickets first, then insert
 *
 * Both modes leave non-demo tickets (e.g. ones created through the webhook)
 * untouched — rows are matched on subject + customer email.
 */
import {
  TICKET_CATEGORY,
  TICKET_STATUS,
  type TicketCategory,
  type TicketStatus,
} from "@ticket/shared";
import { prisma } from "../src/db";

interface TicketSeed {
  subject: string;
  /** null models an un-triaged ticket that no one has categorised yet. */
  category: TicketCategory | null;
}

/**
 * Subjects are interleaved rather than grouped by category, so insertion order
 * (and therefore id order) doesn't correlate with any sortable column. Sorting
 * by status or category has to actually work to produce the right answer.
 */
const TICKETS: TicketSeed[] = [
  { subject: "Cannot log in after password reset", category: TICKET_CATEGORY.Technical },
  { subject: "Refund request for a duplicate charge", category: TICKET_CATEGORY.Refund },
  { subject: "How do I invite a teammate?", category: TICKET_CATEGORY.General },
  { subject: "Feature request: recurring reminders", category: TICKET_CATEGORY.Other },
  { subject: "Urgent - please call me", category: null },
  { subject: "API returns 500 on bulk export", category: TICKET_CATEGORY.Technical },
  { subject: "Charged twice for the annual plan", category: TICKET_CATEGORY.Refund },
  { subject: "Question about seat pricing", category: TICKET_CATEGORY.General },
  { subject: "Feedback on the new navigation", category: TICKET_CATEGORY.Other },
  { subject: "Webhook deliveries stopped overnight", category: TICKET_CATEGORY.Technical },
  { subject: "Where can I find my invoices?", category: TICKET_CATEGORY.General },
  { subject: "Cancel subscription and refund the remainder", category: TICKET_CATEGORY.Refund },
  { subject: "Help", category: null },
  { subject: "Two-factor codes rejected on the iOS app", category: TICKET_CATEGORY.Technical },
  { subject: "Partnership inquiry", category: TICKET_CATEGORY.Other },
  { subject: "Update our company billing address", category: TICKET_CATEGORY.General },
  { subject: "Prorated refund never arrived", category: TICKET_CATEGORY.Refund },
  { subject: "CSV import fails with an encoding error", category: TICKET_CATEGORY.Technical },
  { subject: "Change the account owner", category: TICKET_CATEGORY.General },
  { subject: "Reporting a typo in the docs", category: TICKET_CATEGORY.Other },
  { subject: "Dashboard charts not loading in Safari", category: TICKET_CATEGORY.Technical },
  { subject: "Refund still pending after 10 days", category: TICKET_CATEGORY.Refund },
  { subject: "Do you offer a nonprofit discount?", category: TICKET_CATEGORY.General },
  { subject: "Follow-up on my previous email", category: null },
  { subject: "SSO redirect loop with Okta", category: TICKET_CATEGORY.Technical },
  { subject: "Security researcher: responsible disclosure", category: TICKET_CATEGORY.Other },
  { subject: "Request for a W-9 form", category: TICKET_CATEGORY.General },
  { subject: "Wrong currency charged on renewal", category: TICKET_CATEGORY.Refund },
  { subject: "Rate limit hit despite low traffic", category: TICKET_CATEGORY.Technical },
  { subject: "How to export all of my data", category: TICKET_CATEGORY.General },
  { subject: "Attachments over 5 MB fail to upload", category: TICKET_CATEGORY.Technical },
  { subject: "Requesting a refund for unused seats", category: TICKET_CATEGORY.Refund },
  { subject: "Press inquiry about your Series B", category: TICKET_CATEGORY.Other },
  { subject: "Change plan from monthly to annual", category: TICKET_CATEGORY.General },
  { subject: "Scheduled report never arrived", category: TICKET_CATEGORY.Technical },
  { subject: "Re: your last message", category: null },
  { subject: "Double billing after a plan upgrade", category: TICKET_CATEGORY.Refund },
  { subject: "Add a purchase order number to invoices", category: TICKET_CATEGORY.General },
  { subject: "Search returns stale results", category: TICKET_CATEGORY.Technical },
  { subject: "Job application follow-up", category: TICKET_CATEGORY.Other },
  { subject: "Question about the data retention policy", category: TICKET_CATEGORY.General },
  { subject: "Mobile app crashes on startup", category: TICKET_CATEGORY.Technical },
  { subject: "Refund to a closed bank card", category: TICKET_CATEGORY.Refund },
  { subject: "Need a signed DPA", category: TICKET_CATEGORY.General },
  { subject: "Timezone shown incorrectly on invoices", category: TICKET_CATEGORY.Technical },
  { subject: "Request for a case study", category: TICKET_CATEGORY.Other },
  { subject: "Trial converted to paid without consent", category: TICKET_CATEGORY.Refund },
  { subject: "How to set up custom roles", category: TICKET_CATEGORY.General },
  { subject: "Email notifications going to spam", category: TICKET_CATEGORY.Technical },
  { subject: "Not sure who to contact", category: null },
  { subject: "Increase the API rate limit for our plan", category: TICKET_CATEGORY.General },
  { subject: "Data sync stuck at 40 percent", category: TICKET_CATEGORY.Technical },
  { subject: "Overcharged for add-on storage", category: TICKET_CATEGORY.Refund },
  { subject: "Accessibility feedback on colour contrast", category: TICKET_CATEGORY.Other },
  { subject: "PDF export renders blank pages", category: TICKET_CATEGORY.Technical },
  { subject: "Request a product demo for our team", category: TICKET_CATEGORY.General },
  { subject: "Chargeback filed by mistake", category: TICKET_CATEGORY.Refund },
  { subject: "Session expires every five minutes", category: TICKET_CATEGORY.Technical },
  { subject: "Onboarding call scheduling", category: TICKET_CATEGORY.General },
  { subject: "Suggestion for keyboard navigation", category: TICKET_CATEGORY.Other },
  { subject: "Custom domain SSL certificate error", category: TICKET_CATEGORY.Technical },
  { subject: "Partial refund for the downtime last week", category: TICKET_CATEGORY.Refund },
  { subject: "Question about the uptime SLA", category: TICKET_CATEGORY.General },
  { subject: "Issue with account", category: null },
  { subject: "Zapier integration disconnected", category: TICKET_CATEGORY.Technical },
  { subject: "Rename our workspace", category: TICKET_CATEGORY.General },
  { subject: "Duplicate records after the migration", category: TICKET_CATEGORY.Technical },
  { subject: "Newsletter unsubscribe not working", category: TICKET_CATEGORY.Other },
  { subject: "Transfer projects between workspaces", category: TICKET_CATEGORY.General },
  { subject: "Slow page load on the reports tab", category: TICKET_CATEGORY.Technical },
  { subject: "Zero-usage month, requesting a credit", category: TICKET_CATEGORY.Refund },
  { subject: "Enable the audit log for compliance", category: TICKET_CATEGORY.General },
  { subject: "Keyboard shortcuts not working", category: TICKET_CATEGORY.Technical },
  { subject: "Localization request for German", category: TICKET_CATEGORY.Other },
  { subject: "Question", category: null },
  { subject: "Dark mode contrast issue on tables", category: TICKET_CATEGORY.Technical },
  { subject: "Refund for an accidental annual upgrade", category: TICKET_CATEGORY.Refund },
  { subject: "Yearly renewal quote request", category: TICKET_CATEGORY.General },
  { subject: "File preview shows the wrong thumbnail", category: TICKET_CATEGORY.Technical },
  { subject: "Idea: shared saved filters", category: TICKET_CATEGORY.Other },
  { subject: "Update the primary contact email", category: TICKET_CATEGORY.General },
  { subject: "Bulk delete removed the wrong records", category: TICKET_CATEGORY.Technical },
  { subject: "Invoice paid twice by our finance team", category: TICKET_CATEGORY.Refund },
  { subject: "VAT number missing from the invoice", category: TICKET_CATEGORY.General },
  { subject: "Xero integration failing to sync invoices", category: TICKET_CATEGORY.Technical },
  { subject: "Conference sponsorship inquiry", category: TICKET_CATEGORY.Other },
  { subject: "Extend our trial by two weeks", category: TICKET_CATEGORY.General },
  { subject: "Yesterday's backup did not complete", category: TICKET_CATEGORY.Technical },
  { subject: "Legal hold request", category: TICKET_CATEGORY.Other },
  { subject: "Bulk user provisioning via SCIM", category: TICKET_CATEGORY.General },
  { subject: "Login page blank on Firefox ESR", category: TICKET_CATEGORY.Technical },
  { subject: "Quote for 250 seats", category: TICKET_CATEGORY.General },
  { subject: "Notifications duplicated three times", category: TICKET_CATEGORY.Technical },
  { subject: "Old account cleanup request", category: TICKET_CATEGORY.Other },
  { subject: "Kanban board drag and drop broken", category: TICKET_CATEGORY.Technical },
  { subject: "Query builder times out on large sets", category: TICKET_CATEGORY.Technical },
  { subject: "Vanity URL returns 404", category: TICKET_CATEGORY.Technical },
  { subject: "Uploaded avatar not displaying", category: TICKET_CATEGORY.Technical },
  { subject: "Guest access link expired early", category: TICKET_CATEGORY.Technical },
  { subject: "IP allowlist blocking our office", category: TICKET_CATEGORY.Technical },
];

interface Customer {
  name: string;
  email: string;
}

const CUSTOMERS: Customer[] = [
  { name: "Amelia Hart", email: "amelia.hart@example.com" },
  { name: "Ben Okafor", email: "ben.okafor@example.com" },
  { name: "Carla Mendez", email: "carla.mendez@example.org" },
  { name: "Daniel Whitfield", email: "daniel.whitfield@example.com" },
  { name: "Elena Petrova", email: "elena.petrova@example.net" },
  { name: "Farid Haddad", email: "farid.haddad@example.com" },
  { name: "Grace Lin", email: "grace.lin@example.org" },
  { name: "Hugo Bennett", email: "hugo.bennett@example.com" },
  { name: "Ingrid Solberg", email: "ingrid.solberg@example.net" },
  { name: "Jonas Meyer", email: "jonas.meyer@example.com" },
  { name: "Keiko Tanaka", email: "keiko.tanaka@example.org" },
  { name: "Liam O'Donnell", email: "liam.odonnell@example.com" },
  { name: "Marta Kowalski", email: "marta.kowalski@example.net" },
  { name: "Noah Adeyemi", email: "noah.adeyemi@example.com" },
  { name: "Olivia Marsh", email: "olivia.marsh@example.org" },
  { name: "Priya Raman", email: "priya.raman@example.com" },
  { name: "Quentin Roux", email: "quentin.roux@example.net" },
  { name: "Rosa Iglesias", email: "rosa.iglesias@example.com" },
  { name: "Samuel Bjork", email: "samuel.bjork@example.org" },
  { name: "Tara Nolan", email: "tara.nolan@example.com" },
  { name: "Umar Sheikh", email: "umar.sheikh@example.net" },
  { name: "Vera Lindqvist", email: "vera.lindqvist@example.com" },
  { name: "Wesley Chan", email: "wesley.chan@example.org" },
  { name: "Xenia Popa", email: "xenia.popa@example.com" },
  { name: "Yusuf Demir", email: "yusuf.demir@example.net" },
  { name: "Zoe Almeida", email: "zoe.almeida@example.com" },
  { name: "Aaron Feld", email: "aaron.feld@example.org" },
  { name: "Bianca Rossi", email: "bianca.rossi@example.com" },
  { name: "Callum Reid", email: "callum.reid@example.net" },
  { name: "Dina Farouk", email: "dina.farouk@example.com" },
  { name: "Emeka Nwosu", email: "emeka.nwosu@example.org" },
  { name: "Freya Lund", email: "freya.lund@example.com" },
  { name: "Gabriel Santos", email: "gabriel.santos@example.net" },
  { name: "Hana Kim", email: "hana.kim@example.com" },
  { name: "Isaac Berger", email: "isaac.berger@example.org" },
  { name: "Julia Novak", email: "julia.novak@example.com" },
  { name: "Karim Aziz", email: "karim.aziz@example.net" },
  { name: "Lena Vogel", email: "lena.vogel@example.com" },
  { name: "Mateo Silva", email: "mateo.silva@example.org" },
  { name: "Nadia Rahman", email: "nadia.rahman@example.com" },
];

const NOW = Date.now();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * Older tickets have had time to be worked, so age drives status: the last few
 * weeks skew Open, the last quarter skews Resolved, anything older is mostly
 * Closed. That makes sorting by status and by date give genuinely different
 * answers instead of near-identical ones.
 */
function statusFor(daysAgo: number, index: number): TicketStatus {
  if (daysAgo < 45) {
    return index % 5 === 0 ? TICKET_STATUS.Resolved : TICKET_STATUS.Open;
  }
  if (daysAgo < 120) {
    return index % 3 === 0 ? TICKET_STATUS.Open : TICKET_STATUS.Resolved;
  }
  return index % 7 === 0 ? TICKET_STATUS.Resolved : TICKET_STATUS.Closed;
}

interface TicketRow {
  subject: string;
  category: TicketCategory | null;
  status: TicketStatus;
  customerName: string;
  customerEmail: string;
  assignedToId: string | null;
  createdAt: Date;
  lastMessageAt: Date;
}

function buildRows(assigneeIds: string[]): TicketRow[] {
  const rows = TICKETS.map((ticket, i) => {
    // 37/179 and 17/40 are coprime with their moduli, so both walk their whole
    // range without clumping — spread-out dates and recurring customers, with
    // no hidden correlation to insertion order.
    const daysAgo = (i * 37) % 179;
    const hour = 8 + ((i * 11) % 10); // business hours, 08:00–17:00
    const createdAt = new Date(NOW - daysAgo * DAY);
    createdAt.setHours(hour, (i * 7) % 60, 0, 0);

    const status = statusFor(daysAgo, i);
    // Open tickets are still moving; settled ones went quiet days ago.
    const replyGap =
      status === TICKET_STATUS.Open ? (2 + (i % 8)) * HOUR : (1 + (i % 5)) * DAY;

    const customer = CUSTOMERS[(i * 17) % CUSTOMERS.length];

    return {
      subject: ticket.subject,
      category: ticket.category,
      status,
      customerName: customer.name,
      customerEmail: customer.email,
      // Every third ticket is unassigned, so the queue has real triage work.
      assignedToId:
        i % 3 === 0 ? null : (assigneeIds[i % assigneeIds.length] ?? null),
      createdAt,
      lastMessageAt: new Date(createdAt.getTime() + replyGap),
    };
  });

  // Force a few exact createdAt collisions so the `id desc` tiebreaker is
  // visible in the list rather than theoretical.
  for (const i of [11, 42, 73]) {
    rows[i].createdAt = new Date(rows[i - 1].createdAt);
    rows[i].lastMessageAt = new Date(rows[i - 1].lastMessageAt);
  }

  return rows;
}

function keyOf(row: { subject: string; customerEmail: string }): string {
  return `${row.subject} ${row.customerEmail}`;
}

const reset = process.argv.includes("--reset");

const assignees = await prisma.user.findMany({
  where: { deletedAt: null },
  select: { id: true, email: true },
  orderBy: { createdAt: "asc" },
});

if (assignees.length === 0) {
  throw new Error("No users found — run `bun run db:seed` first.");
}

const rows = buildRows(assignees.map((u) => u.id));
const demoKeys = new Set(rows.map(keyOf));

if (reset) {
  const existing = await prisma.ticket.findMany({
    select: { id: true, subject: true, customerEmail: true },
  });
  const doomed = existing.filter((t) => demoKeys.has(keyOf(t))).map((t) => t.id);

  if (doomed.length > 0) {
    // Messages cascade on ticket delete (see schema.prisma).
    await prisma.ticket.deleteMany({ where: { id: { in: doomed } } });
    console.log(`Removed ${doomed.length} existing demo ticket(s).`);
  }
}

const alreadyThere = new Set(
  (
    await prisma.ticket.findMany({
      select: { subject: true, customerEmail: true },
    })
  ).map(keyOf),
);

const toCreate = rows.filter((row) => !alreadyThere.has(keyOf(row)));

if (toCreate.length === 0) {
  console.log("All demo tickets already present — nothing to do.");
} else {
  const { count } = await prisma.ticket.createMany({ data: toCreate });
  console.log(`Created ${count} demo ticket(s).`);
}

const [total, byStatus, uncategorised] = await Promise.all([
  prisma.ticket.count(),
  prisma.ticket.groupBy({ by: ["status"], _count: true }),
  prisma.ticket.count({ where: { category: null } }),
]);

console.log(`Tickets in database: ${total}`);
console.log(
  `  by status: ${byStatus.map((g) => `${g.status}=${g._count}`).join(", ")}`,
);
console.log(`  uncategorised: ${uncategorised}`);

await prisma.$disconnect();
