/**
 * The rows a converted API test needs in place before it can write its own
 * (#169; the second admin came with #170, the customer and their ticket with
 * #189).
 *
 * Two kinds, and they are here for two different reasons.
 *
 * ## The colleagues
 *
 * Every user-owned table these tests touch — `changelog_seen`, `new_feature_seen`,
 * `dashboard_layout`, `tutorial_progress`, `tutorial_content.updatedById`,
 * `knowledge_article_revision`'s `editorId` and `approvedById`, the four
 * further columns the activity feed reads an actor out of
 * (`ticket_activity.actorId`, `message.authorId`, `admin_activity.actorId` and
 * `automation_settings_revision.changedById`), and `admin_activity`'s
 * `targetUserId`, which names the account acted *on* rather than an actor —
 * hangs off a foreign key onto `user`, so a converted file cannot write a row
 * until the caller exists. That made the same `createMany` block appear in file
 * after file, which is what this module is for.
 *
 * **It owns the rows, not the request headers.** The `../middleware/auth`
 * stub that turns a header into a session is deliberately re-typed in every
 * test file — `docs/standards/testing.md` explains why, and it is the
 * process-wide `mock.module` registry, not tidiness, that requires it — so the
 * header constants stay next to the stub that reads them. What each file
 * imports from here is the identity those headers name, which is what stops a
 * header and a seeded row drifting apart into a foreign-key failure.
 *
 * **Every colleague carries a pinned `createdAt`, and the order of them is
 * load-bearing** (#173). `now()` in Postgres is transaction time, so the
 * `createMany` below used to stamp *every* row with the same instant — and two
 * things then read that column as though it meant something. `GET /api/users`
 * lists the roster `orderBy: { createdAt: "asc" }`, so "lists everyone, oldest
 * first" was passing on whatever order the planner returned tied rows in; and
 * `automation.ts`'s `longestServingAdmin` — the fallback every handed-back
 * ticket lands on — is `createdAt` then `id`, which against a five-way tie
 * would silently be an `id` sort. Pinned dates make both a fact about the
 * rows. The order is `admin` (2025, the founder), then `agent`, `other`,
 * `otherAdmin`, and the assistant last; changing it changes what those two
 * assertions mean.
 *
 * ## The customer, and the ticket they opened
 *
 * A different reason: no foreign key forces this one. `CUSTOMER` and
 * `seedTicket` are here because the same address, the same name and the same
 * "Cannot log in" were typed out in file after file *and asserted on* —
 * `outbound.test.ts` reads the address back off the outbox row the reply was
 * addressed with. A fixture and an assertion that agree only because somebody
 * typed the same string twice are a pair that eventually will not.
 */
import { USER_ROLE } from "@ticket/shared";
import { prisma, type Prisma } from "./pg";

export const COLLEAGUE = {
  agent: {
    id: "u_agent",
    name: "Aaron Agent",
    email: "agent@example.com",
    emailVerified: true,
    role: USER_ROLE.agent,
    createdAt: new Date("2026-02-01T00:00:00.000Z"),
  },
  other: {
    id: "u_other",
    name: "Olivia Other",
    email: "olivia@example.com",
    emailVerified: true,
    role: USER_ROLE.agent,
    createdAt: new Date("2026-03-01T00:00:00.000Z"),
  },
  /** The founding admin: the earliest `createdAt` here, and deliberately so. */
  admin: {
    id: "u_admin",
    name: "Ada Admin",
    email: "ada@example.com",
    emailVerified: true,
    role: USER_ROLE.admin,
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
  },
  /**
   * A *second* admin, for the one rule in this codebase that needs two of them:
   * nobody may approve their own knowledge-base revision (`routes/knowledge.ts`,
   * #23). Approving as `admin` and then as `other` would pass — that router
   * reads the session, never the stored role — and would quietly demonstrate
   * the gate with an agent standing in for the second admin, which leaves the
   * reader with the wrong idea of what the rule is.
   */
  otherAdmin: {
    id: "u_admin_2",
    name: "Bo Admin",
    email: "bo@example.com",
    emailVerified: true,
    role: USER_ROLE.admin,
    createdAt: new Date("2026-04-01T00:00:00.000Z"),
  },
  /**
   * The assistant's account — not a colleague, and here anyway (#172).
   *
   * It is a `user` row like the others (ADR-0002: the assistant is an account,
   * not a role), and `routes/users.ts` refuses to change or delete it on the
   * strength of one column, so a test of those refusals needs the row to
   * exist. Kept beside the people rather than in a corner of its own because
   * what a caller needs from this module is *an identity that is really in the
   * table*, and the assistant is one — the guard reads `automated` off the row,
   * so a locally-typed stand-in would be asserting against itself.
   *
   * Never an actor. Nothing signs in as it: it has no `Account` row, which is
   * the whole of why `sendResetPassword` and `rejectAssistant` both refuse to
   * mint one for it.
   *
   * The address and the name are re-typed here rather than imported from
   * `../automation`'s `ASSISTANT_EMAIL`/`ASSISTANT_NAME`, which is what
   * `prisma/seed.ts` writes — and that is a constraint, not a preference. This
   * module is a *static* import in every test file, so importing `../automation`
   * would link `../db` before any of them reaches its `mock.module` call, and
   * the real `../db` opens a connection at import. `automation.test.ts` closes
   * the gap from the other side: it asserts the seeded row's email against
   * `ASSISTANT_EMAIL`, so the two drifting apart is a test failure.
   */
  assistant: {
    id: "u_assistant",
    name: "AI Assistant",
    email: "assistant@automation.invalid",
    emailVerified: true,
    role: USER_ROLE.agent,
    automated: true,
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
  },
} as const;

export type ColleagueKey = keyof typeof COLLEAGUE;

/**
 * Insert the named colleagues, for a `beforeEach` that has already called
 * `resetDb()`. Named rather than "seed everyone" so each file's list says who
 * its tests are about — a file that seeds an admin it never acts as reads as
 * though the admin mattered.
 */
export function seedColleagues(...who: ColleagueKey[]) {
  return prisma.user.createMany({ data: who.map((key) => COLLEAGUE[key]) });
}

/** The customer on the other end of the tickets these tests are about. */
export const CUSTOMER = {
  email: "customer@example.com",
  name: "Marta",
} as const;

/**
 * One ticket, in whatever state the caller needs.
 *
 * A single overrides bag rather than a parameter per column. What is shared is
 * the customer and a complaint; the columns each file cares about beyond that —
 * `status` and `assignedToId` in `routes/tickets.test.ts`, `createdAt` and
 * `lastMessageAt` in `outbound.test.ts` — have nothing in common but the table,
 * and a signature naming all of them would just be a list of one caller's needs
 * each. That is the shape #189 said to stop at, and this is the side of it that
 * is worth having.
 *
 * `jobs/sweeps.test.ts` deliberately keeps its own: its tickets are opened by a
 * different customer with a different complaint and it wants the sequence to
 * assign the id rather than naming one, so it would override every default here
 * to reach the one line it shares.
 */
export function seedTicket(
  overrides: Partial<Prisma.TicketUncheckedCreateInput> = {},
) {
  return prisma.ticket.create({
    data: {
      subject: "Cannot log in",
      customerEmail: CUSTOMER.email,
      customerName: CUSTOMER.name,
      ...overrides,
    },
  });
}
