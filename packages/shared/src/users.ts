export const USER_ROLE = {
  admin: "admin",
  agent: "agent",
} as const;

export type UserRole = (typeof USER_ROLE)[keyof typeof USER_ROLE];

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  emailVerified: boolean;
  /**
   * This row stands for the assistant, not for a person.
   *
   * There is at most one — a partial unique index in the database says so — and
   * it exists to be an *assignee*: a ticket the knowledge base answered by
   * itself carries its name, so "who dealt with this?" has the same kind of
   * answer whether a colleague or a machine dealt with it.
   *
   * Not a third `UserRole`. A role decides what an account may *do*, and this
   * account does nothing: it has no credential row, so nothing can sign in as
   * it, and every mutating route refuses it. Widening the role union would have
   * put a machine in every place the codebase asks "admin or agent?" — including
   * Better Auth's own config and the route guards — to describe something that
   * is not a permission level.
   *
   * Deliberately not the author of the replies it is assigned to. Those keep
   * `authorId: null` and `automated: true`, because "nobody wrote this" is what
   * an agent reading the thread needs told, and it is not the same fact as "this
   * ticket is filed under the assistant".
   */
  automated: boolean;
  createdAt: string;
}

/**
 * What happened to a colleague's account. The Postgres enum of the same name
 * mirrors this — see the `AdminActivity` model for what each one records and
 * how `fromValue`/`toValue` are used.
 */
export const ADMIN_ACTIVITY_ACTION = {
  user_created: "user_created",
  /** Covers both the initial invite and a resend; `toValue` says which. */
  user_invited: "user_invited",
  user_edited: "user_edited",
  /** A promotion or demotion; `fromValue`/`toValue` are the bare roles. */
  role_changed: "role_changed",
  user_deleted: "user_deleted",
} as const;

export type AdminActivityAction =
  (typeof ADMIN_ACTIVITY_ACTION)[keyof typeof ADMIN_ACTIVITY_ACTION];

export interface UsersListResponse {
  users: User[];
}

export interface CreateUserResponse {
  user: User;
}

export interface UpdateUserResponse {
  user: User;
}

/**
 * `DELETE /api/users/:id`'s 403 for an admin's account. Shown in the Team
 * page's delete dialog, and read by the API and E2E suites, so it lives here
 * rather than as a literal each of them restates.
 */
export const ADMIN_DELETE_REFUSED_MESSAGE =
  "An admin cannot be deleted. Change their role to Agent first.";
