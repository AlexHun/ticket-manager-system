import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type NewFeatureKey,
  type NewFeatureStatusResponse,
} from "@ticket/shared";
import { api } from "@/lib/api";

/**
 * One query key for every "new" badge's status — `GET /api/new-features/status`
 * returns all of them in one round trip (see the route), unlike the tutorial's
 * per-page key: the sidebar renders every nav item at once and needs all of
 * their badge states together.
 */
export const newFeatureKeys = {
  status: ["new-features", "status"] as const,
};

/** Every `NewFeatureKey`'s badge state for the signed-in user. */
export function useNewFeatureStatus() {
  return useQuery({
    queryKey: newFeatureKeys.status,
    queryFn: async ({ signal }) => {
      const { data } = await api.get<NewFeatureStatusResponse>(
        "/api/new-features/status",
        { signal },
      );
      return data.statuses;
    },
  });
}

/**
 * Marks one key seen for the caller. Silent on failure, same reasoning as the
 * tutorial's own "seen" mutation: a badge is supporting decoration, not the
 * thing the click was for, and a failed write costs nothing worse than the
 * dot showing once more on a later visit.
 */
export function useMarkNewFeatureSeen() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (featureKey: NewFeatureKey) => {
      await api.post(`/api/new-features/${featureKey}/seen`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: newFeatureKeys.status });
    },
  });
}
