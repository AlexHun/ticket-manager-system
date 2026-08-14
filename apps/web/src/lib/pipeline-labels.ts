import {
  AUTO_REPLY_DECLINE,
  PIPELINE_STAGE,
  type AutoReplyDecline,
  type PipelineStage,
} from "@ticket/shared";

/**
 * How the unattended pipeline is described in words, in one place.
 *
 * Two screens say these things now — the ticket detail card, which reports one
 * verdict to the agent looking at one ticket, and `/pipeline`, which draws all
 * nine of them on a diagram. The wording is the whole product here: it is what
 * separates "the machine chose not to answer" from "the machine wrote an answer
 * and we destroyed it", and nine carefully-argued sentences maintained in two
 * files are nine sentences that will eventually disagree.
 *
 * (This is `pipeline-labels` rather than `auto-reply-labels` because it grew the
 * stage names too. Same reason: the rail and any future consumer must name the
 * six stops identically or the picture stops being a picture of the code.)
 */

/**
 * What the auto-reply concluded, in words rather than in a key.
 *
 * The wording separates two things an agent must not confuse. Three of these
 * mean *it never wrote anything* — the ticket was ineligible, already answered,
 * or unreadable. Four mean *it wrote a reply and the safety checks destroyed
 * it*, which is a different event entirely and is what an injection attempt
 * looks like from the outside. And one means the assistant was simply
 * unreachable, which is no verdict on the ticket at all.
 *
 * None of it is an error state. Declining is the designed, common outcome, so
 * the ticket card draws this as another field and not as a warning — the ticket
 * is `Open` and waiting, which is exactly what should happen.
 */
export const DECLINE_LABEL: Record<AutoReplyDecline, string> = {
  [AUTO_REPLY_DECLINE.category]: "Not eligible — refunds and unfiled tickets are never auto-answered",
  [AUTO_REPLY_DECLINE.answered]: "Already answered — only opening messages are auto-answered",
  [AUTO_REPLY_DECLINE.noText]: "Nothing to read — the email carried no plain text",
  [AUTO_REPLY_DECLINE.notCovered]: "Not covered by the knowledge base",
  [AUTO_REPLY_DECLINE.noCitation]: "Draft discarded — it cited no article that exists",
  [AUTO_REPLY_DECLINE.unbackedCommitment]: "Draft discarded — it promised something no cited article states",
  [AUTO_REPLY_DECLINE.unbackedReference]: "Draft discarded — it carried a link or address no cited article contains",
  [AUTO_REPLY_DECLINE.tooLong]: "Draft discarded — too long to be a knowledge-base answer",
  [AUTO_REPLY_DECLINE.unavailable]: "The assistant could not be reached",
};

/**
 * The same nine, short enough to sit at the end of a line on the rail.
 *
 * A second set rather than a truncation of the first: the diagram already groups
 * these by the stop they leave from, so "Draft discarded" is said once by the
 * heading above them and would be four wasted words on every row underneath it.
 * The long form still exists for the ticket card, which has no such context.
 */
export const DECLINE_SHORT: Record<AutoReplyDecline, string> = {
  [AUTO_REPLY_DECLINE.category]: "Refund, or still unfiled",
  [AUTO_REPLY_DECLINE.answered]: "Somebody had already replied",
  [AUTO_REPLY_DECLINE.noText]: "No plain text to read",
  [AUTO_REPLY_DECLINE.notCovered]: "Not covered by the knowledge base",
  [AUTO_REPLY_DECLINE.noCitation]: "Cited nothing that resolves",
  [AUTO_REPLY_DECLINE.unbackedCommitment]: "Promised money no article states",
  [AUTO_REPLY_DECLINE.unbackedReference]: "Carried a link no article contains",
  [AUTO_REPLY_DECLINE.tooLong]: "Longer than an answer should be",
  [AUTO_REPLY_DECLINE.unavailable]: "The assistant could not be reached",
};

/** The six stops, named for the rail. */
export const STAGE_LABEL: Record<PipelineStage, string> = {
  [PIPELINE_STAGE.received]: "Email received",
  [PIPELINE_STAGE.classified]: "Classified",
  [PIPELINE_STAGE.eligible]: "Eligible for an unattended answer",
  [PIPELINE_STAGE.drafted]: "Answer drafted",
  [PIPELINE_STAGE.checked]: "Grounding checks",
  [PIPELINE_STAGE.resolved]: "Resolved from the knowledge base",
};

/**
 * One sentence per stop, saying what actually happens there.
 *
 * The page's whole reason for existing: every one of these describes a decision
 * already made in code, and naming the file it lives in is what keeps the
 * diagram checkable against the thing it claims to describe.
 */
export const STAGE_DESCRIPTION: Record<PipelineStage, string> = {
  [PIPELINE_STAGE.received]:
    "A ticket exists and its classification is queued, in one transaction — so the two share a fate. Nothing leaves the rail here.",
  [PIPELINE_STAGE.classified]:
    "A model picks one of four categories. Its output is an enum, so total prompt failure is one mis-filed ticket and nothing else.",
  [PIPELINE_STAGE.eligible]:
    "Three gates run before any model is asked: the category, whether anyone has already replied, and whether there is plain text to read.",
  [PIPELINE_STAGE.drafted]:
    "The ticket is claimed as Processing — invisible to every agent — and answered from the auto-replyable articles alone.",
  [PIPELINE_STAGE.checked]:
    "Four checks run over the finished text, where nothing the customer wrote can argue with them. Every one fails closed.",
  [PIPELINE_STAGE.resolved]:
    "The reply is appended to the thread and the ticket is resolved. The only exit where the machine finished the job.",
};
