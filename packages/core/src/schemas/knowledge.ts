import { z } from "zod";
import {
  KB_BODY_MAX_LENGTH,
  KB_INTERNAL_NOTE_MAX_LENGTH,
  KB_TITLE_MAX_LENGTH,
  TICKET_CATEGORY,
} from "@ticket/shared";

/**
 * What an admin may write into a knowledge-base article.
 *
 * This is the validation in front of the most privileged content in the
 * product: whatever passes here goes into the system prompt of a feature that
 * writes to customers with nobody reading it first. So the limits are not
 * cosmetic, and neither is the trimming.
 *
 * What is deliberately **not** here: any attempt to police what an article
 * *says*. A knowledge base is meant to state policy, prices, addresses and
 * links — that is its whole job, and it is the reason `unbackedCommitments` and
 * `unbackedReferences` compare a reply against the cited article rather than
 * against a word list. An article is the permission. Trying to sanitise it here
 * would break the feature and secure nothing.
 *
 * The real control on content is the `autoReply` flag and the review the audit
 * trail makes possible, not a regex.
 */
export const knowledgeArticleSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Give the article a title")
    .max(
      KB_TITLE_MAX_LENGTH,
      `Title must be ${KB_TITLE_MAX_LENGTH} characters or fewer`,
    ),
  category: z.enum(TICKET_CATEGORY, {
    error: "Pick a category",
  }),
  body: z
    .string()
    .trim()
    .min(1, "An article with no answer in it cannot ground a reply")
    .max(
      KB_BODY_MAX_LENGTH,
      `The answer must be ${KB_BODY_MAX_LENGTH} characters or fewer`,
    ),
  /**
   * Empty means "no note", and stays a `string` here rather than being
   * transformed to `null`.
   *
   * A `.transform()` would make the schema's input and output types differ,
   * which react-hook-form models as a third generic and `zodResolver` then has
   * to be told about — a lot of type ceremony to move one `?? null`. The column
   * is nullable, so the emptiness check happens once, at the route, where the
   * row is written.
   */
  internalNote: z
    .string()
    .trim()
    .max(
      KB_INTERNAL_NOTE_MAX_LENGTH,
      `The internal note must be ${KB_INTERNAL_NOTE_MAX_LENGTH} characters or fewer`,
    ),
  /**
   * Whether the unattended auto-reply may answer from this.
   *
   * No default. A create form that omitted this would be a form that decided
   * the single most consequential field on the screen by leaving it out, and
   * the honest default is not obvious enough to hide — so the client sends it
   * explicitly and the control is always on screen.
   */
  autoReply: z.boolean(),
});

export type KnowledgeArticleValues = z.infer<typeof knowledgeArticleSchema>;

/**
 * Archiving and restoring, which is a separate endpoint from editing.
 *
 * Its own schema and its own route because it is a different act: an edit
 * changes what an article says, this changes whether it exists as far as every
 * future prompt is concerned. Folding it into a PATCH body would let a
 * distracted save archive an article as a side effect of fixing a typo, and
 * would collapse two audit actions into one.
 */
export const knowledgeArchiveSchema = z.object({
  archived: z.boolean(),
});

export type KnowledgeArchiveValues = z.infer<typeof knowledgeArchiveSchema>;
