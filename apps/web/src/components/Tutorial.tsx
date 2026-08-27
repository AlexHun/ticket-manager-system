import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type TutorialPageKey,
  type TutorialStatusResponse,
} from "@ticket/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { tutorialKeys } from "@/lib/tutorial-queries";

/**
 * A page's own tutorial: pops up unprompted the first time a page is opened
 * (or reopened after `TUTORIAL_PAGE_VERSIONS[pageKey]` in `@ticket/shared`
 * has been bumped — see the note there for when a page change warrants one),
 * and never again once dismissed or finished.
 *
 * Silent on every failure mode rather than surfacing one: no content written
 * yet, the status request failed, or the "seen" write failed. A tutorial is
 * supporting material, not the task the page exists for, and a
 * `role="alert"` about it would outrank the real content on a page whose
 * primary request just succeeded. A failed "seen" write costs nothing worse
 * than the tutorial showing once more on a later visit.
 */
export function Tutorial({ pageKey }: { pageKey: TutorialPageKey }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  const { data } = useQuery({
    queryKey: tutorialKeys.status(pageKey),
    queryFn: async ({ signal }) => {
      const { data } = await api.get<TutorialStatusResponse>(
        `/api/tutorials/${pageKey}`,
        { signal },
      );
      return data.tutorial;
    },
  });

  // Fires once per "now visible" transition: `shouldShow` only flips to
  // `true` on a fresh load or after a version bump, and the dismiss/finish
  // mutation below marks it seen before the dialog closes, so a refetch
  // (window refocus, remount) reads `false` and this does not reopen it.
  useEffect(() => {
    if (data?.shouldShow) {
      setStepIndex(0);
      setOpen(true);
    }
  }, [data?.shouldShow]);

  const markSeen = useMutation({
    mutationFn: async () => {
      await api.post(`/api/tutorials/${pageKey}/seen`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: tutorialKeys.status(pageKey),
      });
    },
  });

  if (!data || data.content.steps.length === 0) {
    return null;
  }

  const { title, steps } = data.content;
  const step = steps[stepIndex]!;
  const isLastStep = stepIndex === steps.length - 1;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      markSeen.mutate();
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Step {stepIndex + 1} of {steps.length}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">{step.title}</h3>
          <p className="text-sm text-muted-foreground">{step.body}</p>
        </div>

        <DialogFooter>
          {stepIndex > 0 && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setStepIndex((i) => i - 1)}
            >
              Back
            </Button>
          )}
          {isLastStep ? (
            <Button type="button" onClick={() => handleOpenChange(false)}>
              Got it
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => setStepIndex((i) => i + 1)}
            >
              Next
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
