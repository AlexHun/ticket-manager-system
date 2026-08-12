import type { RequestHandler } from "express";
import type { InboundEmail } from "@ticket/core";

/**
 * Postmark inbound webhook → the `InboundEmail` shape this route already speaks.
 *
 * Postmark posts JSON with the address fields already split and the headers
 * already parsed into `{ Name, Value }` pairs, so this is a mapping and not a
 * parse — no multipart reader, no header-block unfolding, no `From` line to take
 * apart. One trap does all the damage if missed, and it has its own note below:
 * `MessageID` is not the email's Message-ID.
 */

interface PostmarkHeader {
  Name: string;
  Value: string;
}

interface PostmarkAddress {
  Email?: string;
  Name?: string;
}

interface PostmarkInbound {
  From?: string;
  FromName?: string;
  FromFull?: PostmarkAddress;
  Subject?: string;
  MessageID?: string;
  TextBody?: string;
  HtmlBody?: string;
  Headers?: PostmarkHeader[];
}

/**
 * Positive identification, not a guess at what this isn't.
 *
 * `From` plus a `Headers` array is present on every Postmark inbound payload and
 * on nothing else this route accepts — in particular it cannot collide with the
 * native JSON contract, whose fields are lower-cased and carry no `Headers`.
 */
function isPostmarkPayload(body: unknown): body is PostmarkInbound {
  if (!body || typeof body !== "object") return false;
  const candidate = body as PostmarkInbound;
  return typeof candidate.From === "string" && Array.isArray(candidate.Headers);
}

/**
 * Case-insensitive, because header names are case-insensitive by specification
 * and Postmark passes through whatever the sending client wrote — `Message-Id`
 * and `Message-ID` both occur in the wild.
 */
function headerValue(headers: PostmarkHeader[], name: string): string | null {
  const wanted = name.toLowerCase();
  for (const header of headers) {
    if (typeof header?.Name !== "string") continue;
    if (header.Name.toLowerCase() !== wanted) continue;
    const value = typeof header.Value === "string" ? header.Value.trim() : "";
    if (value.length > 0) return value;
  }
  return null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Rewrites a Postmark inbound payload into the body `inboundEmailSchema`
 * validates, so every provider meets at the same gate and the handler below
 * never learns who delivered the mail.
 */
export const postmarkAdapter: RequestHandler = (req, _res, next) => {
  if (!isPostmarkPayload(req.body)) {
    next();
    return;
  }

  const payload = req.body;
  const headers = payload.Headers ?? [];

  // **`MessageID` is Postmark's own UUID for this delivery, not the email's
  // `Message-ID` header.** Threading and dedupe both key off this column, so
  // taking the obvious field would give every message an id no other mail
  // server has ever heard of: `In-Reply-To` on the customer's next reply would
  // match nothing, and every reply would open its own ticket. The real one is in
  // the headers array. Postmark's UUID is kept only as the fallback for mail
  // that genuinely arrived without a `Message-ID`, where its one useful property
  // — stable across Postmark's retries — is exactly what dedupe needs.
  const messageId =
    headerValue(headers, "message-id") ?? text(payload.MessageID);
  if (messageId.length === 0) {
    next();
    return;
  }

  const senderEmail = text(payload.FromFull?.Email) || text(payload.From);
  const senderName =
    text(payload.FromFull?.Name) || text(payload.FromName) || senderEmail;

  const references = headerValue(headers, "references")
    ?.split(/\s+/)
    .filter((ref) => ref.length > 0);

  const inbound: InboundEmail = {
    messageId,
    subject: text(payload.Subject),
    senderEmail,
    senderName,
    // `StrippedTextReply` is deliberately not used. Postmark's guess at where
    // the quoted history starts is good, but the thread is what an agent reads
    // and what the summariser is given, and a body silently missing its context
    // is worse than one carrying too much.
    textBody: typeof payload.TextBody === "string" ? payload.TextBody : undefined,
    htmlBody: typeof payload.HtmlBody === "string" ? payload.HtmlBody : undefined,
    inReplyTo: headerValue(headers, "in-reply-to") ?? undefined,
    references: references && references.length > 0 ? references : undefined,
  };

  req.body = inbound;
  next();
};
