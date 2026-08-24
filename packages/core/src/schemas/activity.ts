import { z } from "zod";
import {
  ACTIVITY_ENTITY_TYPES,
  DEFAULT_PAGE_SIZE,
  FIRST_PAGE,
  MAX_PAGE_SIZE,
} from "@ticket/shared";

/**
 * Sanity ceiling on an actor id — same reasoning and the same number as
 * `ASSIGNEE_ID_MAX_LENGTH` in `schemas/tickets.ts`: Better Auth generates
 * 32-character ids, so anything near this is already nonsense. Not imported
 * from there — that constant isn't exported, and the two are free to drift
 * if a future id format ever needs a different cap for one filter and not
 * the other.
 */
const ACTOR_ID_MAX_LENGTH = 128;

/**
 * Query params for GET /api/activity.
 *
 * Three filters, each optional and independent — "don't narrow on this
 * field" is the absent state for all of them, same as `ticketsQuerySchema`.
 * An unknown `actorId` is a valid filter that returns nothing, not a 400: the
 * route unions five tables with no user-table lookup of its own, and turning
 * "no such user" into an error would mean checking an id against the user
 * table before every request just to answer a question nobody asked.
 *
 * `from`/`to` are a half-open range — `from` inclusive, `to` exclusive — the
 * same shape `ts()` casting gives the dashboard's own range queries, so a
 * range built from two calendar dates (`from = day X`, `to = day X + 1`)
 * reads naturally rather than making the caller reason about whether
 * midnight itself is included.
 */
export const activityQuerySchema = z
  .object({
    actorId: z
      .string({ error: "Invalid actor filter" })
      .trim()
      .min(1, "Invalid actor filter")
      .max(ACTOR_ID_MAX_LENGTH, "Invalid actor filter")
      .optional(),
    entityType: z
      .enum(ACTIVITY_ENTITY_TYPES, { error: "Invalid entity type filter" })
      .optional(),
    from: z.coerce.date({ error: "Invalid start date" }).optional(),
    to: z.coerce.date({ error: "Invalid end date" }).optional(),
    // Query params arrive as strings, hence coerce. A non-numeric value
    // becomes NaN and fails `int()`, so it is rejected rather than silently
    // defaulted.
    page: z.coerce
      .number({ error: "Invalid page" })
      .int("Invalid page")
      .min(FIRST_PAGE, "Invalid page")
      .default(FIRST_PAGE),
    pageSize: z.coerce
      .number({ error: "Invalid page size" })
      .int("Invalid page size")
      .min(1, "Invalid page size")
      .max(MAX_PAGE_SIZE, `Page size cannot exceed ${MAX_PAGE_SIZE}`)
      .default(DEFAULT_PAGE_SIZE),
  })
  .superRefine((value, ctx) => {
    if (value.from && value.to && value.from > value.to) {
      ctx.addIssue({
        code: "custom",
        path: ["to"],
        message: "Start date must be before end date",
      });
    }
  });

export type ActivityQuery = z.infer<typeof activityQuerySchema>;
