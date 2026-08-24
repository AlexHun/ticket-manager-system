import { useQuery } from "@tanstack/react-query";
import type { UsersListResponse } from "@ticket/shared";
import { api } from "@/lib/api";

/** Shared with `UsersPage`, deliberately — the same roster, the same cache entry. */
export const USERS_QUERY_KEY = ["users"];

/**
 * The full user table — admins, agents and the automated assistant account.
 *
 * Admin-only (`GET /api/users`), unlike `useAssigneesQuery`: that roster
 * excludes the assistant on purpose (a ticket can't be *chosen* for it), and
 * this one needs it — the assistant is the actor on every `auto_resolved` /
 * `auto_declined` row the activity feed shows, and an admin filtering the
 * feed by actor has to be able to name it.
 */
export function useUsersQuery({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: USERS_QUERY_KEY,
    queryFn: async ({ signal }) => {
      const { data } = await api.get<UsersListResponse>("/api/users", { signal });
      return data.users;
    },
    enabled,
  });
}
