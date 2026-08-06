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
 * Every ticket gets an email thread, because a ticket without one is a row the
 * detail page can only show its empty state for. The plain run also backfills
 * threads onto demo tickets seeded before this existed, so an already-populated
 * database doesn't have to be reset to get them.
 *
 * Both modes leave non-demo tickets (e.g. ones created through the webhook)
 * untouched — rows are matched on subject + customer email.
 */
import {
  MESSAGE_DIRECTION,
  TICKET_CATEGORY,
  TICKET_STATUS,
  type MessageDirection,
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

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

/** The key an uncategorised ticket picks its opening line from. */
const UNTRIAGED = "untriaged";

/** What the customer's first email says. Category, not subject, sets the tone. */
const OPENING_LINES: Record<TicketCategory | typeof UNTRIAGED, string[]> = {
  [TICKET_CATEGORY.Technical]: [
    "We've been seeing this since yesterday afternoon and it's holding the team up. Happy to send screenshots if they'd help.",
    "It started right after last week's update. Two of us can reproduce it in Chrome; a third colleague can't reproduce it at all.",
    "Nothing changed on our side as far as I know. I'm glad to get on a call if that's quicker than going back and forth by email.",
  ],
  [TICKET_CATEGORY.Refund]: [
    "Could someone take a look and refund the difference? I have the invoice numbers to hand.",
    "The charge went through twice on the same card. Our finance team has checked and it isn't a duplicate on our end.",
    "We cancelled well before the renewal date, so I wasn't expecting to be billed for this month at all.",
  ],
  [TICKET_CATEGORY.General]: [
    "Could you point me in the right direction? I went through the docs first and couldn't find it.",
    "I mainly need to know what the process is before I raise it with the rest of the team.",
    "Not urgent, but it would help to have an answer some time this week.",
  ],
  [TICKET_CATEGORY.Other]: [
    "Let me know who the right person to speak to is and I'll take it from there.",
    "Not strictly a support question, but I wasn't sure where else to send it.",
    "Happy to go into more detail if that's useful — just say the word.",
  ],
  [UNTRIAGED]: [
    "Apologies if this is the wrong address, I wasn't sure who to write to.",
    "Could someone get back to me when they have a moment? Thanks in advance.",
  ],
};

const SUPPORT_FIRST_REPLIES = [
  "Thanks for getting in touch — I've picked this up and I'm digging into it now. I'll come back to you as soon as I have something concrete.",
  "Thanks for the detail, that's genuinely useful. I've raised it internally and I'm waiting to hear back.",
  "Got it, and sorry for the trouble. I'm going through your account now.",
];

const SUPPORT_UPDATES = [
  "Quick update: we've reproduced what you're seeing and a fix is with the team. I'll let you know the moment it ships.",
  "An update from our side — I've passed the details on and someone is looking at it today.",
  "Still on this. Nothing new to report yet, but I didn't want to leave you waiting without a word.",
];

const SUPPORT_RESOLUTIONS = [
  "This should be sorted now — could you confirm it looks right from your side? I'll leave the ticket open a day or two just in case.",
  "All done. I've applied the change to your account, so you should see it straight away.",
  "That's resolved now. Do shout if anything looks off and I'll pick it straight back up.",
];

const CUSTOMER_FOLLOW_UPS = [
  "Thanks for the quick reply. One thing I forgot to mention: it only seems to affect users on the Pro plan.",
  "Any update on this? It's starting to reach a few more people here.",
  "Still seeing it this morning, I'm afraid. Let me know if you need anything else from me.",
];

const CUSTOMER_CLOSINGS = [
  "That's working now — thanks very much for sorting it.",
  "Confirmed from our side. I appreciate the quick turnaround.",
  "Perfect, that's exactly what I needed. Thanks for the help.",
];

/** Who a reply comes from when the ticket is sitting in the unassigned queue. */
const SUPPORT_FALLBACK = { name: "Support Team", email: "support@example.com" };

interface Assignee {
  id: string;
  name: string;
  email: string;
}

interface MessageSeed {
  messageId: string;
  inReplyTo: string | null;
  senderEmail: string;
  senderName: string;
  textBody: string | null;
  htmlBody: string | null;
  direction: MessageDirection;
  createdAt: Date;
}

/**
 * Varies the wording by ticket *and* by position, so neither a column of
 * tickets nor a single thread reads like the same sentence repeated. The stride
 * is coprime with every array length here (all 2 or 3), so it cycles rather
 * than landing on one entry.
 */
function pick(lines: string[], index: number, position: number): string {
  return lines[(index * 7 + position * 3) % lines.length];
}

function firstName(name: string): string {
  return name.split(" ")[0];
}

/**
 * FNV-1a over the ticket's own key. Message-IDs have to be unique across the
 * table, and hashing what identifies the ticket — rather than its position in
 * the list above — keeps a reordered or partly-seeded list from minting an id
 * a surviving row already holds.
 */
function hashKey(key: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Open tickets are mid-conversation; settled ones ran their course. */
function messageCountFor(status: TicketStatus, index: number): number {
  return status === TICKET_STATUS.Open ? 2 + (index % 2) : 3 + (index % 3);
}

function bodyFor(
  source: ThreadSource,
  support: { name: string; email: string },
  index: number,
  position: number,
  count: number,
): string {
  const inbound = position % 2 === 0;
  const last = position === count - 1;
  // An Open ticket is by definition still in flight, so nobody in the thread
  // gets to sign off on it — only a Resolved or Closed one ends with thanks.
  const settled = source.status !== TICKET_STATUS.Open;
  const customer = firstName(source.customerName);

  if (position === 0) {
    const lines = OPENING_LINES[source.category ?? UNTRIAGED];
    return `Hi,\n\n${pick(lines, index, position)}\n\nThanks,\n${customer}`;
  }

  if (inbound) {
    const lines = last && settled ? CUSTOMER_CLOSINGS : CUSTOMER_FOLLOW_UPS;
    return `${pick(lines, index, position)}\n\n${customer}`;
  }

  let lines: string[];
  if (last && settled) {
    lines = SUPPORT_RESOLUTIONS;
  } else if (position === 1) {
    lines = SUPPORT_FIRST_REPLIES;
  } else {
    lines = SUPPORT_UPDATES;
  }

  return `Hi ${customer},\n\n${pick(lines, index, position)}\n\nBest,\n${firstName(support.name)}`;
}

/** The ticket fields a thread is derived from — all a backfilled row can offer. */
interface ThreadSource {
  category: TicketCategory | null;
  status: TicketStatus;
  customerName: string;
  customerEmail: string;
  assignedToId: string | null;
  createdAt: Date;
  lastMessageAt: Date;
}

/**
 * An email thread that fits between the ticket's own two timestamps: the first
 * message lands on `createdAt` and the last on `lastMessageAt`, so the list's
 * "Last message" column keeps telling the truth. Each reply points `inReplyTo`
 * at the one before it, the way the inbound webhook threads real mail.
 */
function buildThread(
  source: ThreadSource,
  key: string,
  index: number,
  assigneesById: Map<string, Assignee>,
): MessageSeed[] {
  const count = messageCountFor(source.status, index);
  const support =
    (source.assignedToId ? assigneesById.get(source.assignedToId) : undefined) ??
    SUPPORT_FALLBACK;

  const start = source.createdAt.getTime();
  // Clamped: a ticket whose lastMessageAt somehow precedes its createdAt would
  // otherwise walk backwards. Equal timestamps are fine — the detail route
  // breaks ties on id.
  const span = Math.max(0, source.lastMessageAt.getTime() - start);
  const hash = hashKey(key);

  const messages: MessageSeed[] = [];
  let previousId: string | null = null;

  for (let position = 0; position < count; position++) {
    const inbound = position % 2 === 0;
    const messageId = `demo-${hash}-${position}@demo.example.com`;
    const text = bodyFor(source, support, index, position, count);
    // A handful of HTML-only senders, so the "no plain-text content" branch of
    // the thread view is reachable in the demo data. Never the first message:
    // an opening email nobody can read is just a broken-looking ticket.
    const htmlOnly = position > 0 && (index + position) % 29 === 0;

    messages.push({
      messageId,
      inReplyTo: previousId,
      senderEmail: inbound ? source.customerEmail : support.email,
      senderName: inbound ? source.customerName : support.name,
      textBody: htmlOnly ? null : text,
      htmlBody: htmlOnly
        ? text
            .split("\n\n")
            .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
            .join("")
        : null,
      direction: inbound
        ? MESSAGE_DIRECTION.inbound
        : MESSAGE_DIRECTION.outbound,
      createdAt: new Date(start + Math.round((span * position) / (count - 1))),
    });

    previousId = messageId;
  }

  return messages;
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

interface TicketRow extends ThreadSource {
  subject: string;
  messages: MessageSeed[];
}

function buildRows(assignees: Assignee[]): TicketRow[] {
  const assigneeIds = assignees.map((a) => a.id);
  const assigneesById = new Map(assignees.map((a) => [a.id, a]));

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

  // Threads last, so they hang off the dates each row actually ended up with —
  // including the collisions just forced above.
  return rows.map((row, i) => ({
    ...row,
    messages: buildThread(row, keyOf(row), i, assigneesById),
  }));
}

function keyOf(row: { subject: string; customerEmail: string }): string {
  return `${row.subject} ${row.customerEmail}`;
}

const reset = process.argv.includes("--reset");

const assignees = await prisma.user.findMany({
  where: { deletedAt: null },
  // name and email are what a support reply is signed with, not just the id the
  // ticket is assigned by.
  select: { id: true, name: true, email: true },
  orderBy: { createdAt: "asc" },
});

if (assignees.length === 0) {
  throw new Error("No users found — run `bun run db:seed` first.");
}

const rows = buildRows(assignees);
const demoKeys = new Set(rows.map(keyOf));
const assigneesById = new Map(assignees.map((a) => [a.id, a]));

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
  console.log("All demo tickets already present — nothing to add.");
} else {
  // createMany can't write a nested thread, so each ticket is its own create.
  // Wrapped in one transaction, so a failure part-way through doesn't leave
  // half a batch behind for the next run to trip over.
  const created = await prisma.$transaction(
    toCreate.map(({ messages, ...ticket }) =>
      prisma.ticket.create({
        data: { ...ticket, messages: { create: messages } },
        select: { id: true },
      }),
    ),
  );
  const written = toCreate.reduce((n, row) => n + row.messages.length, 0);
  console.log(
    `Created ${created.length} demo ticket(s) and ${written} message(s).`,
  );
}

/**
 * Demo tickets seeded before this script wrote threads still have none, and
 * leaving them empty would mean the detail page shows its empty state for most
 * of the database. Only demo rows are touched — a ticket that arrived through
 * the webhook, or that someone made by hand, is not ours to put words into.
 */
const indexByKey = new Map(rows.map((row, i) => [keyOf(row), i]));

const emptyDemoTickets = (
  await prisma.ticket.findMany({
    where: { messages: { none: {} } },
    select: {
      id: true,
      subject: true,
      category: true,
      status: true,
      customerName: true,
      customerEmail: true,
      assignedToId: true,
      createdAt: true,
      lastMessageAt: true,
    },
  })
).filter((ticket) => demoKeys.has(keyOf(ticket)));

if (emptyDemoTickets.length > 0) {
  const backfilled = await prisma.$transaction(
    emptyDemoTickets.map((ticket) => {
      const key = keyOf(ticket);
      // The row's own dates, not the freshly computed ones: `NOW` has moved on
      // since it was seeded, and a thread has to sit inside the timestamps the
      // ticket is actually displayed with.
      const messages = buildThread(
        ticket,
        key,
        indexByKey.get(key) ?? 0,
        assigneesById,
      );
      return prisma.message.createMany({
        data: messages.map((message) => ({ ...message, ticketId: ticket.id })),
      });
    }),
  );
  const written = backfilled.reduce((n, result) => n + result.count, 0);
  console.log(
    `Backfilled ${written} message(s) onto ${emptyDemoTickets.length} existing demo ticket(s).`,
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
