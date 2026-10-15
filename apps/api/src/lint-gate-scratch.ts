// Scratch for #534: a deliberately floating promise, to show the CI lint step
// going red. Reverted in the next commit.
import { prisma } from "./db";

export function countTicketsAndForget(): void {
  prisma.ticket.count();
}
