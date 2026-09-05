/**
 * The colleagues a converted API test acts as (#169, extended in #170).
 *
 * Every table these tests touch — `changelog_seen`, `new_feature_seen`,
 * `dashboard_layout`, `tutorial_progress`, `tutorial_content.updatedById`, and
 * `knowledge_article_revision`'s `editorId` and `approvedById` — hangs off a
 * foreign key onto `user`, so a converted file cannot write a row until the
 * caller exists. That made the same `createMany` block appear in five files at
 * once, which is what this module is for.
 *
 * **It owns the rows, not the request headers.** The `../middleware/auth`
 * stub that turns a header into a session is deliberately re-typed in every
 * test file — `docs/standards/testing.md` explains why, and it is the
 * process-wide `mock.module` registry, not tidiness, that requires it — so the
 * header constants stay next to the stub that reads them. What each file
 * imports from here is the identity those headers name, which is what stops a
 * header and a seeded row drifting apart into a foreign-key failure.
 */
import { USER_ROLE } from "@ticket/shared";
import { prisma } from "./pg";

export const COLLEAGUE = {
  agent: {
    id: "u_agent",
    name: "Aaron Agent",
    email: "agent@example.com",
    emailVerified: true,
    role: USER_ROLE.agent,
  },
  other: {
    id: "u_other",
    name: "Olivia Other",
    email: "olivia@example.com",
    emailVerified: true,
    role: USER_ROLE.agent,
  },
  admin: {
    id: "u_admin",
    name: "Ada Admin",
    email: "ada@example.com",
    emailVerified: true,
    role: USER_ROLE.admin,
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
