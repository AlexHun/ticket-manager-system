import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../apps/api/src/generated/prisma/client";
import { DATABASE_URL } from "./env";

/** Prisma client pointed at the test DB. `log: []` keeps test output readable. */
export const testDb = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
  log: [],
});

/** Delete every ticket; messages cascade via the FK on Message.ticketId. */
export async function resetTickets(): Promise<void> {
  await testDb.ticket.deleteMany();
}
