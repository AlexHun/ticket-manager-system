import { auth } from "../src/auth";
import { ASSISTANT_EMAIL, ASSISTANT_NAME } from "../src/automation";
import { prisma, Role } from "../src/db";

const adminEmail = process.env.SEED_ADMIN_EMAIL;
const adminPassword = process.env.SEED_ADMIN_PASSWORD;

if (!adminEmail || !adminPassword) {
  throw new Error("SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set");
}

const ctx = await auth.$context;

async function upsertUser(
  email: string,
  name: string,
  password: string,
  role: Role,
): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    if (existing.role !== role) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { role },
      });
      console.log(`Updated ${email} role to ${role}`);
    } else {
      console.log(`${email} already exists as ${role} — nothing to do`);
    }
    return;
  }

  const hash = await ctx.password.hash(password);
  const userId = ctx.generateId({ model: "user" });
  const accountId = ctx.generateId({ model: "account" });

  await prisma.user.create({
    data: {
      id: userId,
      email,
      name,
      role,
    },
  });

  await prisma.account.create({
    data: {
      id: accountId,
      userId,
      providerId: "credential",
      accountId: userId,
      password: hash,
    },
  });

  console.log(`Created ${role} user ${email} (id=${userId})`);
}

/**
 * The account tickets the assistant answered are filed under.
 *
 * **This is the one writer of `user.automated`, and that is what keeps there
 * being exactly one of these.** Nothing in the API can set the column — not
 * `POST /api/users`, not the admin update route, not Better Auth — so the
 * invariant is held by this function looking before it creates rather than by a
 * constraint. Run the seed ten times and you get one assistant.
 *
 * Two things it deliberately does not do:
 *
 *   - **No `Account` row.** Every other user here gets one carrying a password
 *     hash, which is what the credential provider checks at sign-in. This one
 *     has none, so there is nothing to check and no password that could be
 *     guessed, reset or leaked into a screenshot. It is not "an account with a
 *     long password"; it is an account that cannot be signed into. `POST
 *     /api/users` cannot make another like it, and `PATCH /api/users/:id`
 *     refuses this row outright — which matters, because setting a password
 *     through that route is exactly what would create the missing row.
 *   - **Role stays `agent`.** Roles decide what an account may do and this one
 *     does nothing; `admin` would hand a machine the knowledge-base editor and
 *     the pipeline simulator on the strength of a column nobody reads at
 *     sign-in, since it never signs in.
 *
 * It is created in production too, unlike the demo agent below. There is no
 * published password to leave behind, and a deployed database is where it is
 * most wanted: without it, every ticket the machine resolves is a ticket with an
 * empty Assignee cell, which is precisely how an untouched one looks.
 */
async function upsertAssistant(): Promise<void> {
  const existing = await prisma.user.findFirst({
    where: { automated: true },
    select: { id: true, email: true },
  });

  if (existing) {
    console.log(
      `Assistant account already exists (${existing.email}) — nothing to do`,
    );
    return;
  }

  const id = ctx.generateId({ model: "user" });
  await prisma.user.create({
    data: {
      id,
      email: ASSISTANT_EMAIL,
      name: ASSISTANT_NAME,
      role: Role.agent,
      automated: true,
      // True so the roster does not draw an "unverified" badge beside a row
      // that has no mailbox to verify. Nothing reads it for this account:
      // verification is a sign-in concern, and this account cannot sign in.
      emailVerified: true,
    },
  });

  console.log(`Created assistant account ${ASSISTANT_EMAIL} (id=${id})`);
}

await upsertUser(adminEmail, "Admin", adminPassword, Role.admin);
await upsertAssistant();

/**
 * The demo agent is dev and test only.
 *
 * Its credentials are hard-coded here and repeated across the E2E helpers and
 * the component tests, which is fine for a database that gets reset — and is an
 * account with a published password the moment this script is pointed at a
 * deployed one. Sign-up is disabled (`disableSignUp: true` in `src/auth.ts`), so
 * seeding is the only way a first user exists; running it against production is
 * therefore a normal, expected thing to do, and this is what stops that from
 * quietly creating a second way in.
 *
 * Real agents are created by the admin through `POST /api/users`.
 */
if (process.env.NODE_ENV === "production") {
  console.log("NODE_ENV=production — skipping the demo agent account");
} else {
  await upsertUser("agent@example.com", "Agent", "password123", Role.agent);
}

await prisma.$disconnect();
