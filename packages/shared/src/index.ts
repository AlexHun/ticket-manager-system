export type TicketStatus = "Open" | "Resolved" | "Closed";

export type TicketCategory =
  | "General"
  | "Technical"
  | "Refund"
  | "Other";

export type UserRole = "admin" | "agent";

export interface Ticket {
  id: string;
  subject: string;
  status: TicketStatus;
  category: TicketCategory;
  customerEmail: string;
  customerName: string | null;
  createdAt: string;
  updatedAt: string;
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
