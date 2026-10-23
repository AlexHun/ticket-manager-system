/**
 * Unit tests for `apps/api/src/routes/outbox.ts` — the retry's refusals: a
 * demo session's email (#325, PRD R10), and the sentence each refusal hands
 * the admin (#487).
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
    // Built around the row's own sentence, which an E2E matches unchanged.
    expect(body.error).toBe(
      "Couldn't retry — that email was written in a demo session, and a demo session's email is never sent.",
    );
    // Not flipped to `queued`: the conditional `updateMany` matched nothing,
    // so no job was enqueued for it either.
    const row = await prisma.outboundEmail.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe(OUTBOUND_EMAIL_STATUS.withheld);
    expect(mailTransportStub.delivered).toEqual([]);
  });

  // The sentence the admin reads beside the row (#487): what failed, then why,
  // ending in a full stop — never a bare status the page would have to word.
  test.each([
    [
      OUTBOUND_EMAIL_STATUS.sent,
      "Couldn't retry — that email was already sent.",
    ],
    [
      OUTBOUND_EMAIL_STATUS.queued,
      "Couldn't retry — that email is already queued to send.",
    ],
  ] as const)("refuses a %s email and says why", async (status, sentence) => {
    const { id } = await prisma.outboundEmail.create({
      data: {
        kind: OUTBOUND_EMAIL_KIND.reply,
        status,
        toEmail: CUSTOMER.email,
        subject: "Re: Cannot log in",
        textBody: "Hello.",
      },
      select: { id: true },
    });

    const res = await fetch(url(`/${id}/retry`), {
      method: "POST",
      headers: asCaller("admin"),
    });

    expect(res.status).toBe(409);
    expect(((await res.json()) as { error?: string }).error).toBe(sentence);
  });

  test("refuses an email that no longer exists and says to reload", async () => {
    const res = await fetch(url("/999999/retry"), {
      method: "POST",
      headers: asCaller("admin"),
    });

    expect(res.status).toBe(404);
    expect(((await res.json()) as { error?: string }).error).toBe(
      "Couldn't retry — that email no longer exists. Reload the Outbox.",
    );
  });

  test("refuses every retry while no mail provider is configured", async () => {
    mailTransportStub.bound = false;

    const res = await fetch(url("/1/retry"), {
      method: "POST",
      headers: asCaller("admin"),
    });

    expect(res.status).toBe(409);
    expect(((await res.json()) as { error?: string }).error).toBe(
      "Couldn't retry — no mail provider is configured.",
    );
  });
});
