import "dotenv/config";
import { auth } from "../src/auth";
import { prisma, Role } from "../src/db";

const email = process.env.SEED_ADMIN_EMAIL;
const password = process.env.SEED_ADMIN_PASSWORD;

if (!email || !password) {
  throw new Error("SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set");
}

const ctx = await auth.$context;

const existing = await prisma.user.findUnique({ where: { email } });

if (existing) {
  if (existing.role !== Role.admin) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { role: Role.admin },
    });
    console.log(`Promoted ${email} to admin`);
  } else {
    console.log(`${email} already exists as admin — nothing to do`);
  }
} else {
  const hash = await ctx.password.hash(password);
  const userId = ctx.generateId({ model: "user" });
  const accountId = ctx.generateId({ model: "account" });

  await prisma.user.create({
    data: {
      id: userId,
      email,
      name: "Admin",
      role: Role.admin,
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

  console.log(`Created admin user ${email} (id=${userId})`);
}

await prisma.$disconnect();
