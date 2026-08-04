export const TICKET_STATUS = {
  Open: "Open",
  Resolved: "Resolved",
  Closed: "Closed",
} as const;

export type TicketStatus = (typeof TICKET_STATUS)[keyof typeof TICKET_STATUS];

export const TICKET_CATEGORY = {
  General: "General",
  Technical: "Technical",
  Refund: "Refund",
  Other: "Other",
} as const;

export type TicketCategory =
  (typeof TICKET_CATEGORY)[keyof typeof TICKET_CATEGORY];

export const USER_ROLE = {
  admin: "admin",
  agent: "agent",
} as const;

export type UserRole = (typeof USER_ROLE)[keyof typeof USER_ROLE];

export interface Ticket {
  id: number;
  subject: string;
  status: TicketStatus;
  category: TicketCategory | null;
  customerEmail: string;
  customerName: string;
  assignedToId: string | null;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Columns the tickets list can be sorted by. Doubles as the table's column ids
 * on the client and as the key into the API's orderBy map, so the two stay
 * in step by construction.
 */
export const TICKET_SORT_FIELD = {
  subject: "subject",
  customerName: "customerName",
  status: "status",
  category: "category",
  createdAt: "createdAt",
} as const;

export type TicketSortField =
  (typeof TICKET_SORT_FIELD)[keyof typeof TICKET_SORT_FIELD];

export const SORT_ORDER = {
  asc: "asc",
  desc: "desc",
} as const;

export type SortOrder = (typeof SORT_ORDER)[keyof typeof SORT_ORDER];

/** What the API sorts by when the request carries no sort params. */
export const DEFAULT_TICKET_SORT = {
  field: TICKET_SORT_FIELD.createdAt,
  order: SORT_ORDER.desc,
} as const;

/**
 * Query-param sentinel for "this ticket has no category". A null can't travel
 * in a query string, and an absent `category` already means "any category".
 */
export const CATEGORY_NONE = "none";

export type TicketCategoryFilter = TicketCategory | typeof CATEGORY_NONE;

/** Longest accepted free-text search, mirrored by the zod schema. */
export const TICKET_SEARCH_MAX_LENGTH = 100;

export const MESSAGE_DIRECTION = {
  inbound: "inbound",
  outbound: "outbound",
} as const;

export type MessageDirection =
  (typeof MESSAGE_DIRECTION)[keyof typeof MESSAGE_DIRECTION];

export interface Message {
  id: number;
  ticketId: number;
  messageId: string;
  inReplyTo: string | null;
  senderEmail: string;
  senderName: string;
  textBody: string | null;
  htmlBody: string | null;
  direction: MessageDirection;
  createdAt: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  emailVerified: boolean;
  createdAt: string;
}

export interface TicketsListResponse {
  tickets: Ticket[];
}

export interface UsersListResponse {
  users: User[];
}

export interface CreateUserResponse {
  user: User;
}

export interface UpdateUserResponse {
  user: User;
}

export interface HealthResponse {
  status: "ok";
}
