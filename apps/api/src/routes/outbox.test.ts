/**
 * Unit tests for `apps/api/src/routes/outbox.ts` — so far, the one thing about
 * it #325 needed pinned: the retry refuses a demo session's email (PRD R10).
 *
 * The retry refuses everything outright while no mail provider is configured,
 * which is every deployment today, so a refusal read through the real
 * transport would be that refusal and prove nothing about a demo row. A
 * provider is stood in by `../test/mail-transport`, the shared stub. The guard
 * is the real `requireAdmin` (#366), so the retry asks as the seeded admin.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  ADMIN_SCREEN,
  OUTBOUND_EMAIL_KIND,
  OUTBOUND_EMAIL_STATUS,
} from "@ticket/shared";
import { refusesAgentAndDemo, screenReads } from "../test/boundary";
import { asCaller } from "../test/caller";
import { CUSTOMER, seedColleagues } from "../test/fixtures";
import { mailTransportStub, stubMailTransport } from "../test/mail-transport";
import { prisma, resetDb } from "../test/pg";
import { serveRouter } from "../test/route-app";

/* ── The world behind the router ─────────────────────────────────────────── */

await stubMailTransport();

const { withholdEmail } = await import("../jobs/send-email");
const { outboxRouter } = await import("./outbox");

const url = serveRouter("/api/outbox", outboxRouter);

beforeEach(async () => {
  mailTransportStub.bound = true;
  mailTransportStub.delivered.length = 0;
  await resetDb();
  await seedColleagues("admin");
});

// Unbound again after every test, so no file loaded after this one inherits a
// provider it never asked for (see `../test/mail-transport`).
afterEach(() => {
  mailTransportStub.bound = false;
});

/* ── Who it refuses (#367) ───────────────────────────────────────────────── */

screenReads(url, outboxRouter, ADMIN_SCREEN.outbox, ["GET /"]);
refusesAgentAndDemo(url, outboxRouter, ["POST /1/retry"]);

/* ── Retry ───────────────────────────────────────────────────────────────── */

describe("POST /api/outbox/:id/retry", () => {
  test("refuses a demo session's email, with a provider configured", async () => {
    const { id } = await prisma.$transaction((tx) =>
      withholdEmail(
        {
          kind: OUTBOUND_EMAIL_KIND.reply,
          toEmail: CUSTOMER.email,
          subject: "Re: Cannot log in",
          textBody: "Hello from a demo.",
        },
        tx,
      ),
    );

    const res = await fetch(url(`/${id}/retry`), {
      method: "POST",
      headers: asCaller("admin"),
    });
    const body = (await res.json()) as { error?: string };

    expect(res.status).toBe(409);
    expect(body.error).toContain("demo session");
    // Not flipped to `queued`: the conditional `updateMany` matched nothing,
    // so no job was enqueued for it either.
    const row = await prisma.outboundEmail.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe(OUTBOUND_EMAIL_STATUS.withheld);
    expect(mailTransportStub.delivered).toEqual([]);
  });
});
