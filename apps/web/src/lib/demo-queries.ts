import { useMutation, useQuery } from "@tanstack/react-query";
import type { DemoStatusResponse, DemoUsageResponse } from "@ticket/shared";
import { api } from "@/lib/api";

export const demoKeys = {
  status: ["demo", "status"] as const,
  usage: ["demo", "usage"] as const,
};

/**
 * Whether this deployment offers a demo session (#319), asked before anyone
 * has signed in — `GET /api/demo` is public.
 *
 * Only a question about whether to draw a button. The sign-in behind it is
 * refused by the API on the same switch, so a stale or wrong answer here
 * costs a button that says "not available" when pressed, never a way in.
 */
export function useDemoStatus() {
  return useQuery({
    queryKey: demoKeys.status,
    queryFn: async ({ signal }) => {
      const { data } = await api.get<DemoStatusResponse>("/api/demo", {
        signal,
      });
      return data.enabled;
    },
  });
}

/**
 * This week's demo figures (#327, PRD R14). Admin-only on the API, which
 * refuses a demo session; `enabled` is whether demo mode is on, so a
 * deployment that never offers the demo never asks.
 */
export function useDemoUsage(enabled: boolean) {
  return useQuery({
    queryKey: demoKeys.usage,
    queryFn: async ({ signal }) => {
      const { data } = await api.get<DemoUsageResponse>("/api/demo/usage", {
        signal,
      });
      return data;
    },
    enabled,
  });
}

/**
 * Tell the API this demo session followed one of the welcome's suggested
 * steps (#464, demo-welcome PRD R11). The API counts a session once however
 * often this fires, so the caller fires it on every step.
 *
 * Fired and never awaited: the step's own link navigates at once, so a slow
 * write never holds the visitor on the welcome. **No toast on failure**, the
 * one departure from frontend.md's mutation rule: the visitor asked to go
 * somewhere and got there, and a lost tally is the owner's figure, not
 * something the visitor can act on.
 */
export function useFollowWelcomeStep() {
  return useMutation({
    mutationFn: async () => {
      await api.post("/api/demo/welcome-step");
    },
  });
}
