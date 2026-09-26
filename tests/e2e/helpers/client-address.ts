import { randomInt } from "node:crypto";

/**
 * Who the API thinks a demo start came from, for the per-address start limit
 * (#322, PRD R9: five an hour).
 *
 * Every request in this suite leaves one machine, so without this every demo
 * start would count against one address and the sixth click of the run would
 * be refused — starving whichever demo spec happened to come later. No proxy
 * stands in front of the E2E API, so the `X-Forwarded-For` a context sends is
 * exactly what Better Auth's `getIp` reads (leftmost entry), which is the same
 * header Railway's edge writes in production. So a spec picks its own client
 * address the way a visitor on another network would have one, and the limit
 * under test is the real one, at its real default.
 *
 * Random rather than counted, because the API servers outlive a run locally
 * (`reuseExistingServer`) and the count lives in their memory for an hour: a
 * counter restarting at 1 each run would land on addresses the last run spent.
 * Drawn from 198.18.0.0/15, reserved for benchmarking (RFC 2544), so it is
 * never somebody's real address.
 */
export function freshClientAddress(): string {
  return `198.${18 + randomInt(2)}.${randomInt(256)}.${randomInt(256)}`;
}

/** The headers that make a context's requests come from `address`. */
export function fromAddress(address: string): Record<string, string> {
  return { "x-forwarded-for": address };
}
