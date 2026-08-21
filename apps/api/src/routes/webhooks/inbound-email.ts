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
 * copy. What stays here is what only a webhook has: a shared-secret check, an
 * optional allowlist of the addresses a provider posts from, a body limit sized
 * for a provider that inlines attachments, and the Postmark translation.
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
 * Ahead of the multipart reader: an unauthenticated caller should be turned
 * away before this process agrees to read a 20MB upload from them.
 */
const requireWebhookAuth: RequestHandler = (req, res, next) => {
  if (!checkBasicAuth(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
};

/**
 * Where Postmark posts from, if we have been told.
 *
 * **This is the second control, not the first.** Postmark does not sign its
 * inbound webhooks — there is no HMAC to verify, which is why the Basic Auth
 * above is the primary check rather than a convenience. What this narrows is
 * the failure that check cannot survive on its own: a webhook URL with the
 * credentials in it, leaked from a browser history, a screenshot or a support
 * ticket. Someone holding one still has to be inside Postmark's network.
 *
 * **It is not in the Caddyfile**, which is where a reverse-proxy allowlist
 * would normally belong, and the reason is in that file: the API keeps its own
 * public domain so Postmark reaches it directly, and `/api/*` through the web
 * service is only how the *browser* gets there. A `remote_ip` matcher over
 * there would guard a door this traffic never uses.
 *
 * **Unset means no check**, deliberately. Local development, the E2E suite and
 * the pipeline simulator all post from somewhere that is not Postmark, and a
 * control which has to be switched off to run the tests is one that gets
 * switched off in production by whoever is debugging at 2am. Set it from
 * Postmark's published list on a deployment that only ever hears from them:
 * https://postmarkapp.com/support/article/800-ips-for-firewalls
 *
 * The address compared is Express's `req.ip`, so it follows the `trust proxy`
 * setting in `index.ts` and does not invent a second opinion about which hop is
 * the client. That setting is measured against one deployment; re-check it
 * before turning this on somewhere with a different number of proxies in front,
 * because getting it wrong here fails *closed* — every delivery 403s and
 * Postmark retries for six hours before giving up on real email.
 */
const WEBHOOK_IPS = (process.env.INBOUND_EMAIL_WEBHOOK_IPS ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter((entry) => entry.length > 0);

/** An IPv4 dotted quad as an unsigned 32-bit number, or null if it isn't one. */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;

  let out = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    out = ((out << 8) | octet) >>> 0;
  }
  return out;
}

/**
 * Does this address satisfy one allowlist entry?
 *
 * Entries are either a literal address — compared as a string, so IPv6 works
 * without a second parser — or IPv4 CIDR, which is the shape a provider
 * publishes ranges in. Anything unparseable matches nothing rather than
 * everything: a typo in the list should lock the door, not leave it open.
 */
function ipMatches(clientIp: string, rule: string): boolean {
  const slash = rule.indexOf("/");
  if (slash === -1) return clientIp === rule;

  const base = ipv4ToInt(rule.slice(0, slash));
  const client = ipv4ToInt(clientIp);
  const bits = Number(rule.slice(slash + 1));
  if (base === null || client === null) return false;
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  if (bits === 0) return true;

  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return ((base & mask) >>> 0) === ((client & mask) >>> 0);
}

const requireWebhookIp: RequestHandler = (req, res, next) => {
  if (WEBHOOK_IPS.length === 0) {
    next();
    return;
  }

  // Node reports an IPv4 peer on a dual-stack socket as `::ffff:1.2.3.4`, which
  // matches no IPv4 rule anyone would write down.
  const clientIp = (req.ip ?? "").replace(/^::ffff:/, "");

  if (!WEBHOOK_IPS.some((rule) => ipMatches(clientIp, rule))) {
    // Logged because the alternative is silent: a genuine delivery refused by a
    // stale allowlist looks, from Postmark's side, exactly like an outage.
    console.warn(`[webhook] refused inbound email from ${clientIp || "unknown"}`);
    res.status(403).json({ error: "Forbidden" });
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
  // Cheapest rejection first: this reads one header-derived value and no body.
  requireWebhookIp,
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
