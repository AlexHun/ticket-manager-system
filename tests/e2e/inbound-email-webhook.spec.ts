import { test, expect, type APIRequestContext, type APIResponse } from "@playwright/test";
import { MESSAGE_DIRECTION, TICKET_STATUS } from "@ticket/shared";
import { resetTickets, testDb } from "./helpers/db";
import {
  WEBHOOK_PASSWORD as PASS,
  WEBHOOK_URL,
  WEBHOOK_USERNAME as USER,
} from "./helpers/env";

function basicAuth(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

const AUTH = basicAuth(USER, PASS);

interface PayloadOptions {
  messageId: string;
  subject?: string;
  senderEmail?: string;
  senderName?: string;
  textBody?: string;
  htmlBody?: string;
  inReplyTo?: string;
  references?: string[];
}

function buildPayload(opts: PayloadOptions): Record<string, unknown> {
  const {
    messageId,
    subject = "Help needed",
    senderEmail = "customer@example.com",
    senderName = "Customer",
    textBody = "hello",
    htmlBody,
    inReplyTo,
    references,
  } = opts;
  const body: Record<string, unknown> = {
    messageId,
    subject,
    senderEmail,
    senderName,
    textBody,
  };
  if (htmlBody) body.htmlBody = htmlBody;
  if (inReplyTo) body.inReplyTo = inReplyTo;
  if (references) body.references = references;
  return body;
}

/**
 * `null` omits the Authorization header entirely. It must not be `undefined` —
 * that would trigger the default parameter and quietly send valid credentials.
 */
function post(
  request: APIRequestContext,
  data: unknown,
  authHeader: string | null = AUTH,
): Promise<APIResponse> {
  return request.post(WEBHOOK_URL, {
    data: data as Record<string, unknown>,
    headers: authHeader ? { Authorization: authHeader } : {},
  });
}

/** POST an email that is expected to succeed, returning the parsed body. */
async function postOk(
  request: APIRequestContext,
  opts: PayloadOptions,
): Promise<{ ticketId: number; threaded: boolean }> {
  const res = await post(request, buildPayload(opts));
  expect(res.status()).toBe(201);
  return res.json();
}

test.beforeEach(async () => {
  await resetTickets();
});

test.afterAll(async () => {
  await testDb.$disconnect();
});

// ---------------------------------------------------------------------------
// Auth — the webhook is public, so Basic Auth is the only gate. Every rejection
// must also leave the database untouched.
// ---------------------------------------------------------------------------

test.describe("Inbound-email webhook — auth", () => {
  const cases: Array<{ name: string; header: string | null }> = [
    { name: "no Authorization header", header: null },
    { name: "wrong password", header: basicAuth(USER, "wrong-pass") },
    { name: "wrong username", header: basicAuth("wrong-user", PASS) },
    { name: "empty credentials", header: basicAuth("", "") },
    { name: "non-Basic scheme", header: `Bearer ${PASS}` },
    { name: "malformed base64 payload", header: "Basic !!!not-base64!!!" },
    { name: "credentials with no colon separator", header: `Basic ${Buffer.from(USER).toString("base64")}` },
  ];

  for (const { name, header } of cases) {
    test(`rejects request with ${name}`, async ({ request }) => {
      const res = await post(
        request,
        buildPayload({ messageId: "auth-reject@example.com" }),
        header,
      );

      expect(res.status()).toBe(401);
      expect(await testDb.ticket.count()).toBe(0);
      expect(await testDb.message.count()).toBe(0);
    });
  }
});

// ---------------------------------------------------------------------------
// Validation — zod rejects before anything is written.
// ---------------------------------------------------------------------------

test.describe("Inbound-email webhook — validation", () => {
  const invalid: Array<{ name: string; body: unknown }> = [
    { name: "empty object", body: {} },
    {
      name: "missing messageId",
      body: { subject: "x", senderEmail: "a@b.com", senderName: "A" },
    },
    {
      name: "empty messageId",
      body: { messageId: "", senderEmail: "a@b.com", senderName: "A" },
    },
    {
      name: "invalid senderEmail",
      body: { messageId: "m@x.com", senderEmail: "not-an-email", senderName: "A" },
    },
    {
      name: "missing senderName",
      body: { messageId: "m@x.com", senderEmail: "a@b.com" },
    },
    {
      name: "empty senderName",
      body: { messageId: "m@x.com", senderEmail: "a@b.com", senderName: "" },
    },
  ];

  for (const { name, body } of invalid) {
    test(`rejects ${name} with 400`, async ({ request }) => {
      const res = await post(request, body);

      expect(res.status()).toBe(400);
      expect(await res.json()).toHaveProperty("error");
      expect(await testDb.ticket.count()).toBe(0);
      expect(await testDb.message.count()).toBe(0);
    });
  }
});

// ---------------------------------------------------------------------------
// Ticket creation — assert on what actually landed in the DB, not just the
// response body.
// ---------------------------------------------------------------------------

test.describe("Inbound-email webhook — ticket creation", () => {
  test("persists a new ticket and its first message", async ({ request }) => {
    const body = await postOk(request, {
      messageId: "first@example.com",
      subject: "Cannot log in",
      senderEmail: "alice@example.com",
      senderName: "Alice",
      textBody: "Login is broken.",
      htmlBody: "<p>Login is broken.</p>",
    });

    expect(body.threaded).toBe(false);

    const ticket = await testDb.ticket.findUniqueOrThrow({
      where: { id: body.ticketId },
      include: { messages: true },
    });

    expect(ticket.subject).toBe("Cannot log in");
    expect(ticket.customerEmail).toBe("alice@example.com");
    expect(ticket.customerName).toBe("Alice");
    expect(ticket.status).toBe(TICKET_STATUS.Open);
    // A freshly ingested ticket is uncategorized and unassigned — classification
    // and assignment are separate concerns.
    expect(ticket.category).toBeNull();
    expect(ticket.assignedToId).toBeNull();

    expect(ticket.messages).toHaveLength(1);
    const message = ticket.messages[0]!;
    expect(message.messageId).toBe("first@example.com");
    expect(message.inReplyTo).toBeNull();
    expect(message.senderEmail).toBe("alice@example.com");
    expect(message.senderName).toBe("Alice");
    expect(message.textBody).toBe("Login is broken.");
    expect(message.htmlBody).toBe("<p>Login is broken.</p>");
    expect(message.direction).toBe(MESSAGE_DIRECTION.inbound);
  });

  test("stores messageId with angle brackets stripped", async ({ request }) => {
    const body = await postOk(request, { messageId: "<wrapped@example.com>" });

    const message = await testDb.message.findFirstOrThrow({
      where: { ticketId: body.ticketId },
    });
    expect(message.messageId).toBe("wrapped@example.com");
  });

  test("omits htmlBody as null when only text is sent", async ({ request }) => {
    const body = await postOk(request, { messageId: "text-only@example.com" });

    const message = await testDb.message.findFirstOrThrow({
      where: { ticketId: body.ticketId },
    });
    expect(message.textBody).toBe("hello");
    expect(message.htmlBody).toBeNull();
  });

  const subjects: Array<{ sent: string; stored: string }> = [
    { sent: "Re: Some old thread", stored: "Some old thread" },
    { sent: "RE: Shouting reply", stored: "Shouting reply" },
    { sent: "Fwd: A forward", stored: "A forward" },
    { sent: "Fw: Short forward", stored: "Short forward" },
    { sent: "", stored: "(no subject)" },
    { sent: "Re: ", stored: "(no subject)" },
    { sent: "Plain subject", stored: "Plain subject" },
  ];

  for (const { sent, stored } of subjects) {
    test(`normalizes subject ${JSON.stringify(sent)} to ${JSON.stringify(stored)}`, async ({
      request,
    }) => {
      const body = await postOk(request, {
        messageId: `subject-${Buffer.from(sent).toString("hex")}@example.com`,
        subject: sent,
      });

      const ticket = await testDb.ticket.findUniqueOrThrow({
        where: { id: body.ticketId },
      });
      expect(ticket.subject).toBe(stored);
    });
  }
});

// ---------------------------------------------------------------------------
// Threading — replies attach to the parent's ticket instead of opening a new one.
// ---------------------------------------------------------------------------

test.describe("Inbound-email webhook — threading", () => {
  test("threads a reply via inReplyTo onto the existing ticket", async ({
    request,
  }) => {
    const first = await postOk(request, {
      messageId: "parent@example.com",
      subject: "Question",
      senderEmail: "bob@example.com",
      senderName: "Bob",
    });

    const reply = await postOk(request, {
      messageId: "child@example.com",
      subject: "Re: Question",
      senderEmail: "bob@example.com",
      senderName: "Bob",
      inReplyTo: "<parent@example.com>",
    });

    expect(reply.threaded).toBe(true);
    expect(reply.ticketId).toBe(first.ticketId);

    expect(await testDb.ticket.count()).toBe(1);

    const ticket = await testDb.ticket.findUniqueOrThrow({
      where: { id: first.ticketId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });

    // The thread keeps the original subject — replies must not rewrite it.
    expect(ticket.subject).toBe("Question");
    expect(ticket.messages.map((m) => m.messageId)).toEqual([
      "parent@example.com",
      "child@example.com",
    ]);
    expect(ticket.messages[1]!.inReplyTo).toBe("parent@example.com");
  });

  test("advances lastMessageAt when a reply arrives", async ({ request }) => {
    const first = await postOk(request, { messageId: "lm-parent@example.com" });
    const before = await testDb.ticket.findUniqueOrThrow({
      where: { id: first.ticketId },
    });

    await postOk(request, {
      messageId: "lm-child@example.com",
      inReplyTo: "lm-parent@example.com",
    });

    const after = await testDb.ticket.findUniqueOrThrow({
      where: { id: first.ticketId },
    });
    expect(after.lastMessageAt.getTime()).toBeGreaterThan(
      before.lastMessageAt.getTime(),
    );
  });

  test("threads via references when inReplyTo is absent", async ({ request }) => {
    const first = await postOk(request, { messageId: "root@example.com" });

    const reply = await postOk(request, {
      messageId: "grandchild@example.com",
      references: ["<older@example.com>", "<root@example.com>"],
    });

    expect(reply.threaded).toBe(true);
    expect(reply.ticketId).toBe(first.ticketId);
    expect(await testDb.ticket.count()).toBe(1);
  });

  test("prefers the most recent reference when several are known", async ({
    request,
  }) => {
    const older = await postOk(request, { messageId: "thread-a@example.com" });
    const newer = await postOk(request, { messageId: "thread-b@example.com" });
    expect(newer.ticketId).not.toBe(older.ticketId);

    // References run oldest → newest, so the last known id wins (RFC 5322 §3.6.4).
    const reply = await postOk(request, {
      messageId: "thread-reply@example.com",
      references: ["<thread-a@example.com>", "<thread-b@example.com>"],
    });

    expect(reply.threaded).toBe(true);
    expect(reply.ticketId).toBe(newer.ticketId);
  });

  test("opens a new ticket when the parent is unknown", async ({ request }) => {
    const orphan = await postOk(request, {
      messageId: "orphan@example.com",
      subject: "Re: Never seen this",
      inReplyTo: "<does-not-exist@example.com>",
    });

    expect(orphan.threaded).toBe(false);
    expect(await testDb.ticket.count()).toBe(1);

    const ticket = await testDb.ticket.findUniqueOrThrow({
      where: { id: orphan.ticketId },
    });
    expect(ticket.subject).toBe("Never seen this");
  });
});

// ---------------------------------------------------------------------------
// Dedup — providers retry, so a repeated Message-ID must be a no-op that still
// returns 2xx (a 4xx would keep the provider retrying forever).
// ---------------------------------------------------------------------------

test.describe("Inbound-email webhook — dedup", () => {
  test("returns 200 and writes nothing on a duplicate messageId", async ({
    request,
  }) => {
    const payload = buildPayload({ messageId: "dup@example.com" });

    const first = await post(request, payload);
    expect(first.status()).toBe(201);
    const { ticketId } = await first.json();

    const second = await post(request, payload);
    expect(second.status()).toBe(200);
    expect(await second.json()).toEqual({ deduped: true, ticketId });

    expect(await testDb.ticket.count()).toBe(1);
    expect(await testDb.message.count()).toBe(1);
  });

  test("dedups a redelivered reply without duplicating the thread", async ({
    request,
  }) => {
    const first = await postOk(request, { messageId: "redeliver-parent@example.com" });
    const replyPayload = buildPayload({
      messageId: "redeliver-child@example.com",
      inReplyTo: "redeliver-parent@example.com",
    });

    expect((await post(request, replyPayload)).status()).toBe(201);
    expect((await post(request, replyPayload)).status()).toBe(200);

    expect(await testDb.ticket.count()).toBe(1);
    expect(
      await testDb.message.count({ where: { ticketId: first.ticketId } }),
    ).toBe(2);
  });
});
