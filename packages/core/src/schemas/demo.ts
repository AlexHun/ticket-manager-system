import { z } from "zod";
import { DEMO_AI_LIMIT_REASON } from "@ticket/shared";

/**
 * The refusal `POST /api/ai/polish-reply` and `/summarize-ticket` send a demo
 * session once the day's demo AI budget is spent (#321, PRD R8).
 *
 * The client parses an error body with this rather than reading `reason` off it
 * by hand: this 429 and the per-user rate limit's share a status, and the
 * `reason` is the only thing telling a fact about the demo apart from an error
 * worth retrying.
 */
export const demoAiLimitSchema = z.object({
  reason: z.literal(DEMO_AI_LIMIT_REASON),
  error: z.string(),
});
