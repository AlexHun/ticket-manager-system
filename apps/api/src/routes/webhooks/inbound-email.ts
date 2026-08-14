import express, { Router } from "express";
import type { Request, RequestHandler, Response } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import type { z, ZodType } from "zod";
import { inboundEmailSchema } from "@ticket/core";
import { INGEST_OUTCOME, ingestInboundEmail } from "../../ingest";
import { postmarkAdapter } from "./postmark";

/**
 * The front door: what a mail provider posts to.
 *
 * Everything about *receiving* an email — dedup, threading, the reopen rule, the
 * transaction that creates a ticket and enqueues its classification — moved to
 * `src/ingest.ts`, because the pipeline simulator at `/pipeline` needs to run
 * exactly the same path and a second copy of it would be a demonstration of the
 * copy. What stays here is what only a webhook has: a shared-secret check, a
 * body limit sized for a provider that inlines attachments, and the Postmark
 * translation.
 */

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

  const result = await ingestInboundEmail(body);

  // The wire shape predates the shared ingest module and is unchanged: Postmark
  // is configured against it, and the E2E suite asserts on it.
  if (result.outcome === INGEST_OUTCOME.deduped) {
    res.status(200).json({ deduped: true, ticketId: result.ticketId });
    return;
  }

  res.status(201).json({
    ticketId: result.ticketId,
    threaded: result.outcome === INGEST_OUTCOME.threaded,
  });
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
