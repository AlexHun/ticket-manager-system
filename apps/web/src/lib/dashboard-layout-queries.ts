import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  type DashboardLayoutResponse,
  type DashboardPanelPlacement,
} from "@ticket/shared";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import { extractErrorMessage } from "@/lib/errors";

export const dashboardLayoutKeys = {
  all: ["dashboard-layout"] as const,
};

/**
 * The signed-in user's saved panel layout, defaulted where they have never
 * customized — see `GET /api/dashboard-layout`.
 *
 * Split out of the hook so the dashboard's loader (`DashboardPage.loader.ts`)
 * can prime the same entry the hook then reads. It stays in this module rather
 * than moving to `dashboard-queries.ts` with the other two: `dashboardLayoutKeys`
 * and the three mutations below all name this one entry, and separating the read
 * from the writes that patch it optimistically would put the key in two files.
 * The loader importing this module costs nothing extra — `toast` and
 * `extractErrorMessage` are already in the entry chunk, via the `<Toaster />`
 * `main.tsx` mounts.
 */
export function dashboardLayoutQueryOptions() {
  return queryOptions({
    queryKey: dashboardLayoutKeys.all,
    queryFn: async ({ signal }) => {
      const { data } = await api.get<DashboardLayoutResponse>(
        "/api/dashboard-layout",
        { signal },
      );
      return data;
    },
  });
}

export function useDashboardLayoutQuery() {
  return useQuery(dashboardLayoutQueryOptions());
}

/**
 * Persists a reorder or resize. Applied to the cache optimistically —
 * `DashboardPage` reads the layout straight back out of this query, so
 * waiting on the round trip before moving a panel would make every drag and
 * every keyboard move feel laggy — and rolled back if the write fails, with
 * an error toast surfacing what silently reverted.
 */
export function useSaveDashboardLayout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (layout: DashboardPanelPlacement[]) => {
      const { data } = await api.put<DashboardLayoutResponse>(
        "/api/dashboard-layout",
        { layout },
      );
      return data;
    },
    onMutate: async (layout) => {
      await queryClient.cancelQueries({ queryKey: dashboardLayoutKeys.all });
      const previous = queryClient.getQueryData<DashboardLayoutResponse>(
        dashboardLayoutKeys.all,
      );
      queryClient.setQueryData<DashboardLayoutResponse>(dashboardLayoutKeys.all, {
        layout,
        isDefault: false,
      });
      return { previous };
    },
    onError: (err, _layout, context) => {
      if (context?.previous) {
        queryClient.setQueryData(dashboardLayoutKeys.all, context.previous);
      }
      toast.error(extractErrorMessage(err, "Failed to save dashboard layout"));
    },
    onSuccess: (data) => {
      queryClient.setQueryData(dashboardLayoutKeys.all, data);
    },
  });
}

/** "Reset to default": deletes the saved row and reverts the cache the same
 * way, optimistically, with the same rollback-on-failure shape as a save. */
export function useResetDashboardLayout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { data } = await api.delete<DashboardLayoutResponse>(
        "/api/dashboard-layout",
      );
      return data;
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: dashboardLayoutKeys.all });
      const previous = queryClient.getQueryData<DashboardLayoutResponse>(
        dashboardLayoutKeys.all,
      );
      return { previous };
    },
    onError: (err, _void, context) => {
      if (context?.previous) {
        queryClient.setQueryData(dashboardLayoutKeys.all, context.previous);
      }
      toast.error(extractErrorMessage(err, "Failed to reset dashboard layout"));
    },
    onSuccess: (data) => {
      queryClient.setQueryData(dashboardLayoutKeys.all, data);
      toast.success("Dashboard reset to default");
    },
  });
}
