import { z } from "zod";
import {
  CATEGORY_NONE,
  DEFAULT_TICKET_SORT,
  SORT_ORDER,
  TICKET_CATEGORY,
  TICKET_SEARCH_MAX_LENGTH,
  TICKET_SORT_FIELD,
  TICKET_STATUS,
} from "@ticket/shared";

/**
 * Query params for GET /api/tickets.
 *
 * Sort params default, so omitting them yields the newest-first order the list
 * page asks for on first load. Filter params are optional and absent means
 * "don't narrow on this field" — `category=none` is the sentinel for tickets
 * that have no category at all.
 */
export const ticketsQuerySchema = z.object({
  sort: z
    .enum(TICKET_SORT_FIELD, { error: "Invalid sort field" })
    .default(DEFAULT_TICKET_SORT.field),
  order: z
    .enum(SORT_ORDER, { error: "Invalid sort order" })
    .default(DEFAULT_TICKET_SORT.order),
  status: z
    .enum(TICKET_STATUS, { error: "Invalid status filter" })
    .optional(),
  category: z
    .enum([...Object.values(TICKET_CATEGORY), CATEGORY_NONE], {
      error: "Invalid category filter",
    })
    .optional(),
  q: z
    .string()
    .trim()
    .max(
      TICKET_SEARCH_MAX_LENGTH,
      `Search is limited to ${TICKET_SEARCH_MAX_LENGTH} characters`,
    )
    .optional(),
});

export type TicketsQuery = z.infer<typeof ticketsQuerySchema>;
