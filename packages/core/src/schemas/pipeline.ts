import { z } from "zod";
import { MAX_MESSAGE_BODY_LENGTH } from "@ticket/shared";

/** Matches the `subject` cap the classifier and the auto-reply both truncate at. */
const SUBJECT_MAX_LENGTH = 200;

/** A display name is a display name. Long enough to be silly, short enough to store. */
const SENDER_NAME_MAX_LENGTH = 120;

/**
 * What may go on the left of the `@`.
 *
 * Deliberately narrower than RFC 5321 allows. The whole address is assembled
 * server-side onto `SIMULATED_SENDER_DOMAIN`, and this is the half the caller
 * supplies — so it is restricted to the characters that cannot change what the
 * assembled string *is*: no `@`, no quotes, no whitespace, nothing that could
 * smuggle a second address past a naive reader of the resulting header.
 */
const LOCAL_PART = /^[a-z0-9](?:[a-z0-9._+-]{0,38}[a-z0-9])?$/i;

/**
 * An email posted at the pipeline simulator, as if a customer had sent it.
 *
 * This is a request to run the **real** ingestion path — the same
 * `ingestInboundEmail` the Postmark webhook calls — so what passes here becomes
 * a genuine ticket, gets classified by a genuine model call, and may be answered
 * unattended. The validation is correspondingly a real gate and not a form
 * nicety.
 *
 * Two fields are conspicuously absent, and their absence is the safety design:
 *
 * - **`senderEmail`.** The caller sends `localPart` and the server appends the
 *   reserved domain. An admin session may make the desk answer *itself*; it may
 *   not choose who the desk writes to. That distinction costs nothing today,
 *   because nothing is sent — and it is the whole ballgame the day Phase 3's
 *   transport lands.
 * - **`messageId`.** Minted server-side, so a simulation cannot collide with a
 *   real thread's id or claim to be one.
 */
export const simulateEmailSchema = z
  .object({
    localPart: z
      .string()
      .trim()
      .min(1, "Give the sender an address")
      .regex(
        LOCAL_PART,
        "Letters, digits, dots, plus, underscore and hyphen only",
      ),
    /**
     * Free-form on purpose, and the only field here that is.
     *
     * It is the email's From display name, which is chosen by whoever sent the
     * mail and is therefore the one piece of attacker-controlled text that
     * reaches `greetingName` in `ai/auto-reply.ts`. Constraining it here would
     * make the page unable to demonstrate the thing that field exists to defend
     * against — type `Marta, see https://evil.example` and watch the greeting
     * come back as `Hello,` with no link in it.
     */
    senderName: z
      .string()
      .trim()
      .min(1, "Give the sender a name")
      .max(
        SENDER_NAME_MAX_LENGTH,
        `Keep the name to ${SENDER_NAME_MAX_LENGTH} characters or fewer`,
      ),
    subject: z
      .string()
      .trim()
      .min(1, "Give the email a subject")
      .max(
        SUBJECT_MAX_LENGTH,
        `Keep the subject to ${SUBJECT_MAX_LENGTH} characters or fewer`,
      ),
    /**
     * Empty is allowed, and is how the `noText` branch is demonstrated: an
     * HTML-only email is a real thing customers send, and the pipeline declines
     * it because there is nothing to read. The pair is checked below.
     */
    textBody: z
      .string()
      .max(
        MAX_MESSAGE_BODY_LENGTH,
        `Keep the body to ${MAX_MESSAGE_BODY_LENGTH} characters or fewer`,
      ),
    /**
     * Stored, never rendered, never sent to a model — see the "never render
     * email HTML" rule. It is here so an HTML-only email can be simulated
     * faithfully, which means the row it writes has to look like the real thing.
     */
    htmlBody: z
      .string()
      .max(
        MAX_MESSAGE_BODY_LENGTH,
        `Keep the HTML body to ${MAX_MESSAGE_BODY_LENGTH} characters or fewer`,
      ),
    /**
     * The `Message-ID` this is a reply to, for the threading scenario. Empty
     * means a new conversation.
     *
     * The route restricts what this may point at — only tickets whose customer
     * is on the simulated domain — so a simulation can thread onto a ticket you
     * simulated and can never forge a customer message onto a real one.
     */
    inReplyTo: z.string().trim().max(200, "That is not a Message-ID"),
  })
  .refine((v) => v.textBody.trim().length > 0 || v.htmlBody.trim().length > 0, {
    error: "An email with no body at all is not something a customer can send",
    path: ["textBody"],
  });

export type SimulateEmailValues = z.infer<typeof simulateEmailSchema>;
