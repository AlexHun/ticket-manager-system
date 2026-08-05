import { z } from "zod";
import {
  CATEGORY_NONE,
  DEFAULT_PAGE_SIZE,
  DEFAULT_TICKET_SORT,
  FIRST_PAGE,
  MAX_PAGE_SIZE,
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
  // Query params arrive as strings, hence coerce. A non-numeric value becomes
  // NaN and fails `int()`, so it is rejected rather than silently defaulted.
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
});

export type TicketsQuery = z.infer<typeof ticketsQuerySchema>;
