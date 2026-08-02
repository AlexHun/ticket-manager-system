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

  const existing = await prisma.message.findUnique({ where: { messageId } });
  if (existing) {
    res.status(200).json({ deduped: true, ticketId: existing.ticketId });
    return;
  }

  const parentCandidates = [inReplyTo, ...[...refs].reverse()].filter(
    (v): v is string => Boolean(v),
  );

  let ticketId: number | null = null;
  for (const candidate of parentCandidates) {
    const parent = await prisma.message.findUnique({
      where: { messageId: candidate },
      select: { ticketId: true },
    });
    if (parent) {
      ticketId = parent.ticketId;
      break;
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
