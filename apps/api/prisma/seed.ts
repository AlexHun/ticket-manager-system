import { auth } from "../src/auth";
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

await upsertUser(adminEmail, "Admin", adminPassword, Role.admin);

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
