import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChangelogStatusResponse } from "@ticket/shared";
import { api } from "@/lib/api";

export const changelogKeys = {
  status: ["changelog", "status"] as const,
};

/** Whether the signed-in user has unseen changelog entries. */
export function useChangelogStatus() {
  return useQuery({
    queryKey: changelogKeys.status,
    queryFn: async ({ signal }) => {
      const { data } = await api.get<ChangelogStatusResponse>(
        "/api/changelog/status",
        { signal },
      );
      return data.shouldShow;
    },
  });
}

/**
 * Marks the latest entry seen for the caller. Silent on failure, same
 * reasoning as `useMarkNewFeatureSeen`: the badge is supporting decoration,
 * not the thing the click was for, and a failed write costs nothing worse
 * than the dot showing once more on a later visit.
 */
export function useMarkChangelogSeen() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      await api.post("/api/changelog/seen");
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: changelogKeys.status });
    },
  });
}
