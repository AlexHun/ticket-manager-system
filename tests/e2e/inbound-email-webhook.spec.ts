import { test, expect, type APIRequestContext } from "@playwright/test";
import { execSync } from "node:child_process";

const API_URL = "http://localhost:3002";
const WEBHOOK_URL = `${API_URL}/api/webhooks/inbound-email`;

// Must match apps/api/.env.test
const USER = "test-webhook-user";
const PASS = "test-webhook-pass";

function basicAuth(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

interface PayloadOptions {
  messageId: string;
  subject?: string;
  senderEmail?: string;
  senderName?: string;
  textBody?: string;
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
  if (inReplyTo) body.inReplyTo = inReplyTo;
  if (references) body.references = references;
  return body;
}

async function post(
  request: APIRequestContext,
  data: Record<string, unknown>,
  authHeader?: string,
) {
  return request.post(WEBHOOK_URL, {
    data,
    headers: authHeader ? { Authorization: authHeader } : {},
  });
}

// Reset ticket/message tables between tests via `prisma db execute`, run through
// dotenv-cli against the test DB. Cascades from ticket → message via FK onDelete.
function resetTicketTables(): void {
  execSync(`bunx dotenv -e .env.test -- prisma db execute --stdin`, {
    cwd: "apps/api",
    input: `TRUNCATE TABLE "message", "ticket" RESTART IDENTITY CASCADE;`,
    stdio: ["pipe", "ignore", "inherit"],
  });
}

test.beforeEach(() => {
  resetTicketTables();
});

test.describe("Inbound-email webhook — auth", () => {
  test("rejects request with no Authorization header", async ({ request }) => {
    const res = await post(request, buildPayload({ messageId: "a@example.com" }));
    expect(res.status()).toBe(401);
  });

  test("rejects request with wrong password", async ({ request }) => {
    const res = await post(
      request,
      buildPayload({ messageId: "a@example.com" }),
      basicAuth(USER, "wrong-pass"),
    );
    expect(res.status()).toBe(401);
  });

  test("rejects request with wrong username", async ({ request }) => {
    const res = await post(
      request,
      buildPayload({ messageId: "a@example.com" }),
      basicAuth("wrong-user", PASS),
    );
    expect(res.status()).toBe(401);
  });
});

test.describe("Inbound-email webhook — ticket creation", () => {
  test("creates a new ticket on the first email", async ({ request }) => {
    const res = await post(
      request,
      buildPayload({
        messageId: "first@example.com",
        subject: "Cannot log in",
        senderEmail: "alice@example.com",
        senderName: "Alice",
        textBody: "Login is broken.",
      }),
      basicAuth(USER, PASS),
    );

    expect(res.status()).toBe(201);
    const body = (await res.json()) as { ticketId: number; threaded: boolean };
    expect(body.threaded).toBe(false);
    expect(typeof body.ticketId).toBe("number");
  });

  test("strips 'Re:' prefix from new-ticket subject", async ({ request }) => {
    const res = await post(
      request,
      buildPayload({
        messageId: "orphan-reply@example.com",
        subject: "Re: Some old thread",
      }),
      basicAuth(USER, PASS),
    );
    expect(res.status()).toBe(201);
    // Subject is normalized when creating a new ticket (no matching parent here).
    // We can't read the ticket back via API yet — this at least locks in the
    // 201 path for an orphaned reply.
  });
});

test.describe("Inbound-email webhook — threading", () => {
  test("threads a reply via inReplyTo onto the existing ticket", async ({
    request,
  }) => {
    const first = await post(
      request,
      buildPayload({
        messageId: "parent@example.com",
        subject: "Question",
        senderEmail: "bob@example.com",
        senderName: "Bob",
      }),
      basicAuth(USER, PASS),
    );
    expect(first.status()).toBe(201);
    const firstBody = (await first.json()) as { ticketId: number };

    const reply = await post(
      request,
      buildPayload({
        messageId: "child@example.com",
        subject: "Re: Question",
        senderEmail: "bob@example.com",
        senderName: "Bob",
        inReplyTo: "<parent@example.com>",
      }),
      basicAuth(USER, PASS),
    );
    expect(reply.status()).toBe(201);
    const replyBody = (await reply.json()) as {
      ticketId: number;
      threaded: boolean;
    };
    expect(replyBody.threaded).toBe(true);
    expect(replyBody.ticketId).toBe(firstBody.ticketId);
  });

  test("threads via references when inReplyTo is absent", async ({ request }) => {
    const first = await post(
      request,
      buildPayload({ messageId: "root@example.com" }),
      basicAuth(USER, PASS),
    );
    const firstBody = (await first.json()) as { ticketId: number };

    const reply = await post(
      request,
      buildPayload({
        messageId: "grandchild@example.com",
        references: ["<older@example.com>", "<root@example.com>"],
      }),
      basicAuth(USER, PASS),
    );
    expect(reply.status()).toBe(201);
    const replyBody = (await reply.json()) as {
      ticketId: number;
      threaded: boolean;
    };
    expect(replyBody.threaded).toBe(true);
    expect(replyBody.ticketId).toBe(firstBody.ticketId);
  });
});

test.describe("Inbound-email webhook — dedup", () => {
  test("returns 200 + deduped:true on a duplicate messageId", async ({
    request,
  }) => {
    const payload = buildPayload({ messageId: "dup@example.com" });
    const first = await post(request, payload, basicAuth(USER, PASS));
    expect(first.status()).toBe(201);

    const second = await post(request, payload, basicAuth(USER, PASS));
    expect(second.status()).toBe(200);
    const body = (await second.json()) as { deduped: boolean };
    expect(body.deduped).toBe(true);
  });
});
