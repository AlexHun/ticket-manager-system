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

  // `query` is opt-in rather than the dev default. Logging every statement is
  // genuinely useful when tracing an N+1 or checking a plan — and useless the
  // rest of the time, when the dashboard's eight aggregates bury whatever you
  // were actually reading. Turn it on for a session with
  // `PRISMA_LOG_QUERIES=1 bun run dev`.
  const isProduction = process.env.NODE_ENV === "production";
  const logQueries = !isProduction && process.env.PRISMA_LOG_QUERIES === "1";

  return new PrismaClient({
    adapter,
    log: isProduction
      ? ["error"]
      : logQueries
        ? ["query", "error", "warn"]
        : ["error", "warn"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
