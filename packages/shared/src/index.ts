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
  email: string;
  role: UserRole;
  active: boolean;
}

export interface HealthResponse {
  status: "ok";
}
