/**
 * The send worker with a mail provider bound (#325, PRD R10).
 *
 * No deployment binds one yet, so a provider is stood in by
 * `../test/mail-transport`: `deliver` records what it was handed. The question
 * this file asks is the one that matters on the day Postmark is bound — does a
 * demo visitor's reply ever reach the transport — and the first test is the
 * control that makes the answer mean something: an ordinary queued row does.
 *
 * `./send-email` itself is not mocked here, but `../test/send-email` may have
 * replaced its `enqueueEmail` for the whole process if another file loaded
 * first. Nothing below goes through `enqueueEmail`: the queued row is inserted
 * directly, and a demo reply never calls it. `SEND_EMAIL_WORKER` and
 * `withholdEmail` are genuine either way, since that stub spreads the real
 * module.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { OUTBOUND_EMAIL_KIND, OUTBOUND_EMAIL_STATUS } from "@ticket/shared";
import {
  COLLEAGUE,
  CUSTOMER,
  seedColleagues,
  seedTicket,
} from "../test/fixtures";
import { mailTransportStub, stubMailTransport } from "../test/mail-transport";
import { prisma, resetDb } from "../test/pg";

await stubMailTransport();

const { SEND_EMAIL_WORKER } = await import("./send-email");
const { REPLY_ORIGIN, sendReply } = await import("../outbound");

const TICKET_ID = 1;

beforeEach(async () => {
  mailTransportStub.bound = true;
  mailTransportStub.delivered.length = 0;
  await resetDb();
  await seedColleagues("demoVisitor");
  await seedTicket({ id: TICKET_ID });
});

// Unbound again after every test, so no file loaded after this one inherits a
// provider it never asked for (see `../test/mail-transport`).
afterEach(() => {
  mailTransportStub.bound = false;
});

describe("with a mail provider bound", () => {
  test("a queued row is handed to the transport and marked sent", async () => {
    const { id } = await prisma.outboundEmail.create({
      data: {
        kind: OUTBOUND_EMAIL_KIND.reply,
        toEmail: CUSTOMER.email,
        subject: "Re: Cannot log in",
        textBody: "Your parcel shipped Friday.",
      },
    });

    await SEND_EMAIL_WORKER.handle({ outboundEmailId: id });

    expect(mailTransportStub.delivered.map((e) => e.toEmail)).toEqual([
      CUSTOMER.email,
    ]);
    const row = await prisma.outboundEmail.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe(OUTBOUND_EMAIL_STATUS.sent);
  });

  test("a demo visitor's reply never reaches the transport, even when a job arrives for it", async () => {
    await sendReply({
      ticketId: TICKET_ID,
      textBody: "Hello from a demo.",
      origin: {
        kind: REPLY_ORIGIN.agent,
        author: {
          id: COLLEAGUE.demoVisitor.id,
          name: COLLEAGUE.demoVisitor.name,
          email: COLLEAGUE.demoVisitor.email,
          isAnonymous: true,
        },
      },
    });
    const { id } = await prisma.outboundEmail.findFirstOrThrow();

    // Nothing enqueues one, so this is a job that should not exist — a
    // replayed or hand-sent one. The worker acts only on a queued row.
    await SEND_EMAIL_WORKER.handle({ outboundEmailId: id });

    expect(mailTransportStub.delivered).toEqual([]);
    const row = await prisma.outboundEmail.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe(OUTBOUND_EMAIL_STATUS.withheld);
    expect(row.attempts).toBe(0);
  });
});
