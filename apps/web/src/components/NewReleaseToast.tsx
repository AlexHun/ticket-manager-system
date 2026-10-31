import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "@/components/ui/sonner";
import {
  RELEASE_CHECK_INTERVAL_MS,
  isReplaced,
  releaseQueryOptions,
} from "@/lib/release-check";

export const NEW_RELEASE_TOAST = {
  title: "A new version was deployed",
  description: "Reload the page to use it.",
  action: "Reload",
} as const;

/**
 * Tells a tab left open across a deploy that it is running the previous
 * release, and offers the reload that fixes it (#452).
 *
 * A stale tab is not harmless here. On develop each deploy serves React under
 * new URLs, so the lazy routes a stale tab opens next load a second React
 * (#451); in production they ask for chunks the deploy deleted. Both end in
 * `AppErrorBoundary`, which reloads by itself when this check says so.
 *
 * The query refetches when the tab comes back (the app's
 * `refetchOnWindowFocus`) and on the interval while it stays visible. Each
 * release is told once: dismissing the toast holds until the next deploy.
 */
export function NewReleaseToast() {
  const { data: served } = useQuery({
    ...releaseQueryOptions(),
    refetchInterval: RELEASE_CHECK_INTERVAL_MS,
  });
  const told = useRef<string | null>(null);

  useEffect(() => {
    if (!isReplaced(served) || told.current === served) return;
    told.current = served;
    toast.info(NEW_RELEASE_TOAST.title, {
      id: "new-release",
      description: NEW_RELEASE_TOAST.description,
      duration: Infinity,
      action: {
        label: NEW_RELEASE_TOAST.action,
        onClick: () => window.location.reload(),
      },
    });
  }, [served]);

  return null;
}
