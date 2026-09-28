/**
 * Unit tests for `apps/api/src/routes/outbox.ts` — so far, the one thing about
 * it #325 needed pinned: the retry refuses a demo session's email (PRD R10).
 *
 * The retry refuses everything outright while no mail provider is configured,
 * which is every deployment today, so a refusal read through the real
 * transport would be that refusal and prove nothing about a demo row. A
 * provider is stood in by `../test/mail-transport`, the shared stub.
 *
 * The `../middleware/auth` stub is deliberately identical to
 * `new-features.test.ts`'s, for the reason explained there: `mock.module`
 * registrations are process-wide.
 */

import type { NextFunction, Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { OUTBOUND_EMAIL_KIND, OUTBOUND_EMAIL_STATUS } from "@ticket/shared";
import { CUSTOMER } from "../test/fixtures";
import { mailTransportStub, stubMailTransport } from "../test/mail-transport";
import { prisma, resetDb } from "../test/pg";
import { serveRouter } from "../test/route-app";

/* ── The world behind the router ─────────────────────────────────────────── */

await stubMailTransport();

/** Deliberately identical to `new-features.test.ts` — see this file's header. */
const fakeGuard = (req: Request, res: Response, next: NextFunction) => {
  res.locals.session = {
    user: {
      id: req.header("x-test-user") ?? "agent-1",
      name: req.header("x-test-agent-name") ?? "Aaron Agent",
      email: req.header("x-test-user-email") ?? "agent@example.com",
      isAnonymous: req.header("x-test-demo") === "true",
    },
    session: { id: req.header("x-test-session") ?? "sess-1" },
  };
  next();
};

mock.module("../middleware/auth", () => ({
  requireAuth: fakeGuard,
  requireAdmin: fakeGuard,
  requireAdminView: fakeGuard,
  sessionOf: (res: Response) => res.locals.session,
}));

const { withholdEmail } = await import("../jobs/send-email");
const { outboxRouter } = await import("./outbox");

const url = serveRouter("/api/outbox", outboxRouter);

beforeEach(async () => {
  mailTransportStub.bound = true;
  mailTransportStub.delivered.length = 0;
  await resetDb();
});

// Unbound again after every test, so no file loaded after this one inherits a
// provider it never asked for (see `../test/mail-transport`).
afterEach(() => {
  mailTransportStub.bound = false;
});

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

    const res = await fetch(url(`/${id}/retry`), { method: "POST" });
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
