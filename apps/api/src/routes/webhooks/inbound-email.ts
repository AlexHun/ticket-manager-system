import express, { Router } from "express";
import type { Request, RequestHandler, Response } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import type { z, ZodType } from "zod";
import { fromPrisma } from "pg-boss";
import { inboundEmailSchema } from "@ticket/core";
import { TICKET_STATUS } from "@ticket/shared";
import { prisma } from "../../db";
import { enqueueClassification } from "../../jobs/classify-ticket";
import { postmarkAdapter } from "./postmark";

function parseBody<S extends ZodType>(
  schema: S,
  req: Request,
  res: Response,
): z.infer<S> | null {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return null;
  }
  return parsed.data;
}

function stripAngles(value: string): string {
  return value.trim().replace(/^<|>$/g, "");
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function checkBasicAuth(req: Request): boolean {
  const expectedUser = process.env.INBOUND_EMAIL_WEBHOOK_USERNAME ?? "";
  const expectedPass = process.env.INBOUND_EMAIL_WEBHOOK_PASSWORD ?? "";
  if (expectedUser.length === 0 || expectedPass.length === 0) return false;

  const header = req.header("authorization") ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Basic" || !token) return false;

  let decoded: string;
  try {
    decoded = Buffer.from(token, "base64").toString("utf8");
  } catch {
    return false;
  }

  const sep = decoded.indexOf(":");
  if (sep === -1) return false;
  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);

  return (
    timingSafeEqual(sha256(user), sha256(expectedUser)) &&
    timingSafeEqual(sha256(pass), sha256(expectedPass))
  );
}

/**
 * First in the chain, and specifically ahead of the multipart reader: an
 * unauthenticated caller should be turned away before this process agrees to
 * read a 20MB upload from them.
 */
const requireWebhookAuth: RequestHandler = (req, res, next) => {
  if (!checkBasicAuth(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
};

export const inboundEmailRouter = Router();

const handleInboundEmail = async (req: Request, res: Response) => {
  const body = parseBody(inboundEmailSchema, req, res);
  if (!body) return;

  const messageId = stripAngles(body.messageId);
  const inReplyTo = body.inReplyTo ? stripAngles(body.inReplyTo) : undefined;
  const refs = (body.references ?? [])
    .map(stripAngles)
    .filter((s) => s.length > 0);

  // Only the ticket id is read below. Without the select this loads `textBody`
  // and `htmlBody` — two full email bodies, the largest columns in the schema —
  // to answer a yes/no question.
  const existing = await prisma.message.findUnique({
    where: { messageId },
    select: { ticketId: true },
  });
  if (existing) {
    res.status(200).json({ deduped: true, ticketId: existing.ticketId });
    return;
  }

  // Best parent first: the direct reply, then references newest-first.
  const parentCandidates = [inReplyTo, ...[...refs].reverse()].filter(
    (v): v is string => Boolean(v),
  );

  // One query for every candidate rather than one per candidate. A long thread
  // carries a dozen or more ids in `References`, and asked one at a time that
  // is a dozen sequential round trips on a webhook the provider is timing.
  //
  // The order above is the whole point of this block, and the database does not
  // preserve it — so the rows go into a map and the winner is chosen by walking
  // `parentCandidates`, never by taking the first row returned.
  // A first email carries neither header, and that is the common case — so it
  // skips the lookup entirely rather than asking the database to match nothing.
  let ticketId: number | null = null;
  if (parentCandidates.length > 0) {
    const parents = await prisma.message.findMany({
      where: { messageId: { in: parentCandidates } },
      select: { messageId: true, ticketId: true },
    });
    const ticketByMessageId = new Map(
      parents.map((p) => [p.messageId, p.ticketId]),
    );

    for (const candidate of parentCandidates) {
      const found = ticketByMessageId.get(candidate);
      if (found !== undefined) {
        ticketId = found;
        break;
      }
    }
  }

  const messageData = {
    messageId,
    inReplyTo: inReplyTo ?? null,
    senderEmail: body.senderEmail,
    senderName: body.senderName,
    textBody: body.textBody ?? null,
    htmlBody: body.htmlBody ?? null,
  };

  if (ticketId !== null) {
    await prisma.$transaction([
      prisma.message.create({ data: { ...messageData, ticketId } }),
      prisma.ticket.update({
        where: { id: ticketId },
        data: { lastMessageAt: new Date() },
      }),
      // A customer writing back to a ticket the *machine* resolved reopens it.
      //
      // Without this the auto-reply has a hole rather than a feature: a
      // knowledge-base answer that missed the point leaves the customer replying
      // "that didn't help" into a ticket marked Resolved, which no agent
      // filtering for open work will ever see. A resolve that swallows the
      // follow-up is not a resolve.
      //
      // Narrowed to `autoResolvedAt` on purpose, and that is why the column
      // exists. A human who resolves a ticket has judged it finished and is
      // usually right; undoing that on every "thanks, that worked!" would reopen
      // half the queue. Nobody made that judgement here.
      //
      // `updateMany` because the `where` is doing the work — a plain `update`
      // addresses by id and would reopen tickets a person had settled.
      prisma.ticket.updateMany({
        where: { id: ticketId, autoResolvedAt: { not: null } },
        data: { status: TICKET_STATUS.Open, autoResolvedAt: null },
      }),
    ]);
    res.status(201).json({ ticketId, threaded: true });
    return;
  }

  const subject =
    body.subject.replace(/^(re|fwd?):\s*/gi, "").trim() || "(no subject)";

  // The ticket and the request to classify it commit together or not at all.
  //
  // What must never be awaited before answering Postmark is the *model call* —
  // a mail provider times this request, a slow webhook is retried, and a retried
  // webhook is duplicate ingestion. Enqueuing is not that: it is one INSERT into
  // a table in the same database, inside the transaction that is already
  // happening. The classification itself still runs long after this response, on
  // a worker.
  //
  // Doing it inside the transaction closes a real gap. Scheduling after the
  // response, as this did while the queue lived in memory, leaves a window
  // between the ticket committing and the work being recorded; a crash inside it
  // produced a ticket that nothing would ever classify and nothing would ever
  // report. Now the two facts share a fate.
  //
  // Only on creation. A reply arriving on an existing thread does not re-open the
  // question of what that ticket is about, and re-classifying on every inbound
  // message would spend a call per email to argue with whatever an agent had
  // already filed it under.
  const ticket = await prisma.$transaction(async (tx) => {
    const created = await tx.ticket.create({
      data: {
        subject,
        customerEmail: body.senderEmail,
        customerName: body.senderName,
        messages: { create: messageData },
      },
      select: { id: true },
    });

    await enqueueClassification(created.id, fromPrisma(tx));

    return created;
  });

  res.status(201).json({ ticketId: ticket.id, threaded: false });
};

// Auth, then the body, then the Postmark → `InboundEmail` translation, then the
// handler that has always been here. The adapter passes a body it does not
// recognise through untouched, so the provider-neutral JSON contract this route
// was built on still works — what Postmark posts and what `curl` posts meet at
// the same `inboundEmailSchema.safeParse`.
inboundEmailRouter.post(
  "/",
  requireWebhookAuth,
  // This router is mounted above the app-wide `express.json()` so it can carry
  // its own limit. Postmark inlines attachments into the JSON body as base64 and
  // allows 35MB of them, so the global 10mb cap would 413 a customer's
  // screenshot — and a 413 is a delivery Postmark retries for six hours and then
  // abandons, which is an email silently lost. Placed after the auth check on
  // purpose: nobody unauthenticated gets to hand this process 45MB to buffer.
  express.json({ limit: "45mb" }),
  postmarkAdapter,
  handleInboundEmail,
);
