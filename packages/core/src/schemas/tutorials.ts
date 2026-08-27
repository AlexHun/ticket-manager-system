import { z } from "zod";
import {
  TUTORIAL_MAX_STEPS,
  TUTORIAL_STEP_ANCHOR_MAX_LENGTH,
  TUTORIAL_STEP_BODY_MAX_LENGTH,
  TUTORIAL_STEP_TITLE_MAX_LENGTH,
  TUTORIAL_TITLE_MAX_LENGTH,
} from "@ticket/shared";

/**
 * What an admin may write for one tutorial step.
 *
 * Unlike a knowledge-base article, this text never reaches a model — it is
 * shown verbatim to whoever is looking at the page it describes — so there is
 * no grounding or citation concern here, only a length ceiling to keep a step
 * from becoming a wall of text.
 */
export const tutorialStepSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Give the step a title")
    .max(
      TUTORIAL_STEP_TITLE_MAX_LENGTH,
      `Step title must be ${TUTORIAL_STEP_TITLE_MAX_LENGTH} characters or fewer`,
    ),
  body: z
    .string()
    .trim()
    .min(1, "A step with nothing to say isn't a step")
    .max(
      TUTORIAL_STEP_BODY_MAX_LENGTH,
      `Step body must be ${TUTORIAL_STEP_BODY_MAX_LENGTH} characters or fewer`,
    ),
  // Whatever the admin picked from that page's anchor dropdown, or omitted
  // for a centered step — see `TutorialStep.anchor` in `@ticket/shared` for
  // why this is never validated against a live element here.
  anchor: z
    .string()
    .trim()
    .max(
      TUTORIAL_STEP_ANCHOR_MAX_LENGTH,
      `Anchor id must be ${TUTORIAL_STEP_ANCHOR_MAX_LENGTH} characters or fewer`,
    )
    .optional(),
});

/**
 * One page's tutorial content, as an admin edits it.
 *
 * At least one step, deliberately: `steps.length === 0` is how
 * `GET /api/tutorials/:pageKey` recognises "nobody has authored this page
 * yet" and keeps the tutorial from showing — see the route. Saving a
 * zero-step tutorial through this schema would collapse that signal, so the
 * only way back to "no content" is to never save, not to save empty.
 */
export const tutorialContentSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Give the tutorial a title")
    .max(
      TUTORIAL_TITLE_MAX_LENGTH,
      `Title must be ${TUTORIAL_TITLE_MAX_LENGTH} characters or fewer`,
    ),
  steps: z
    .array(tutorialStepSchema)
    .min(1, "A tutorial needs at least one step")
    .max(TUTORIAL_MAX_STEPS, `A tutorial can have at most ${TUTORIAL_MAX_STEPS} steps`),
});

export type TutorialStepValues = z.infer<typeof tutorialStepSchema>;
export type TutorialContentValues = z.infer<typeof tutorialContentSchema>;
