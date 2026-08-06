import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

export { Role } from "./generated/prisma/client";
// A value export, not `export type`: `Prisma` is a namespace, so this one line
// carries both the types (`Prisma.TicketWhereInput`) and the runtime helpers
// (`Prisma.sql`, `Prisma.empty`, `Prisma.join`) the raw stats queries compose
// with. Exported as a type only, `Prisma.sql` is `undefined` at import time.
export { Prisma } from "./generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "production"
        ? ["error"]
        : ["query", "error", "warn"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
