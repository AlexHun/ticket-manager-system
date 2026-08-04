import { z } from "zod";
import {
  DEFAULT_TICKET_SORT,
  SORT_ORDER,
  TICKET_SORT_FIELD,
} from "@ticket/shared";

/**
 * Query params for GET /api/tickets. Both params are optional — omitting them
 * yields the default newest-first order, which is what the list page requests
 * on first load anyway.
 */
export const ticketsQuerySchema = z.object({
  sort: z
    .enum(TICKET_SORT_FIELD, { error: "Invalid sort field" })
    .default(DEFAULT_TICKET_SORT.field),
  order: z
    .enum(SORT_ORDER, { error: "Invalid sort order" })
    .default(DEFAULT_TICKET_SORT.order),
});

export type TicketsQuery = z.infer<typeof ticketsQuerySchema>;
