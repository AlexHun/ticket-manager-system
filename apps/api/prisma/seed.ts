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
await upsertUser("agent@example.com", "Agent", "password123", Role.agent);

await prisma.$disconnect();
