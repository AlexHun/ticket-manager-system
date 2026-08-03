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
