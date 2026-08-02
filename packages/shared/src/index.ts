export type TicketStatus = "Open" | "Resolved" | "Closed";

export type TicketCategory =
  | "General"
  | "Technical"
  | "Refund"
  | "Other";

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

export type MessageDirection = "inbound" | "outbound";

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
