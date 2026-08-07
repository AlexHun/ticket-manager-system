import { Router } from "express";
import type { Request, Response } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import type { z, ZodType } from "zod";
import { inboundEmailSchema } from "@ticket/core";
import { prisma } from "../../db";

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

export const inboundEmailRouter = Router();

inboundEmailRouter.post("/", async (req: Request, res: Response) => {
  if (!checkBasicAuth(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

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
    ]);
    res.status(201).json({ ticketId, threaded: true });
    return;
  }

  const subject =
    body.subject.replace(/^(re|fwd?):\s*/gi, "").trim() || "(no subject)";

  const ticket = await prisma.ticket.create({
    data: {
      subject,
      customerEmail: body.senderEmail,
      customerName: body.senderName,
      messages: { create: messageData },
    },
    select: { id: true },
  });

  res.status(201).json({ ticketId: ticket.id, threaded: false });
});
