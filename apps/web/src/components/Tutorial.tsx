import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
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
 * A step whose `anchor` resolves to a live `data-tutorial-anchor` element on
 * the page (see `apps/web/src/lib/tutorial-anchors.ts`) renders as a callout
 * beside that element — a dot on it, a connector line, the copy in a box next
 * to it — instead of a screen-centered dialog. A step with no anchor, or
 * whose element isn't (yet, or ever) on the page, falls back to the centered
 * `Dialog` rather than pointing at nothing; `AnchoredCallout` below gives a
 * newly-mounting target a couple of seconds to appear before giving up.
 *
 * Silent on every other failure mode too: no content written yet, the status
 * request failed, or the "seen" write failed. A tutorial is supporting
 * material, not the task the page exists for, and a `role="alert"` about it
 * would outrank the real content on a page whose primary request just
 * succeeded. A failed "seen" write costs nothing worse than the tutorial
 * showing once more on a later visit.
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

  const body = (
    <div className="flex flex-col gap-1">
      <h3 className="text-sm font-medium">{step.title}</h3>
      <p className="text-sm text-muted-foreground">{step.body}</p>
    </div>
  );

  const footer = (
    <div className="flex justify-end gap-2">
      {stepIndex > 0 && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setStepIndex((i) => i - 1)}
        >
          Back
        </Button>
      )}
      {isLastStep ? (
        <Button type="button" size="sm" onClick={() => handleOpenChange(false)}>
          Got it
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          onClick={() => setStepIndex((i) => i + 1)}
        >
          Next
        </Button>
      )}
    </div>
  );

  if (step.anchor) {
    return (
      <AnchoredCallout
        anchorId={step.anchor}
        open={open}
        title={title}
        stepIndex={stepIndex}
        stepCount={steps.length}
        body={body}
        footer={footer}
        onClose={() => handleOpenChange(false)}
        fallback={
          <CenteredDialog
            open={open}
            onOpenChange={handleOpenChange}
            title={title}
            stepIndex={stepIndex}
            stepCount={steps.length}
            body={body}
            footer={footer}
          />
        }
      />
    );
  }

  return (
    <CenteredDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={title}
      stepIndex={stepIndex}
      stepCount={steps.length}
      body={body}
      footer={footer}
    />
  );
}

function CenteredDialog({
  open,
  onOpenChange,
  title,
  stepIndex,
  stepCount,
  body,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  stepIndex: number;
  stepCount: number;
  body: ReactNode;
  footer: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Step {stepIndex + 1} of {stepCount}
          </DialogDescription>
        </DialogHeader>
        {body}
        <DialogFooter>{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const CALLOUT_WIDTH = 320;
const GAP = 14;
const VIEWPORT_PADDING = 16;
/** How long a step waits for its tagged element to mount before giving up
 * and falling back to the centered dialog — long enough for the host page's
 * own data fetch to resolve, short enough that giving up still reads as
 * instant. */
const ANCHOR_WAIT_MS = 4000;
const ANCHOR_POLL_MS = 150;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

interface Placement {
  side: "right" | "left" | "bottom" | "top";
  dot: { x: number; y: number };
  line: { x: number; y: number };
  calloutLeft: number;
  calloutTop: number;
  ringRect: { left: number; top: number; width: number; height: number };
}

function computePlacement(target: DOMRect, calloutHeight: number): Placement {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const canRight = vw - target.right >= GAP + CALLOUT_WIDTH + VIEWPORT_PADDING;
  const canLeft = target.left >= GAP + CALLOUT_WIDTH + VIEWPORT_PADDING;
  const canBottom =
    vh - target.bottom >= GAP + calloutHeight + VIEWPORT_PADDING;

  const side: Placement["side"] = canRight
    ? "right"
    : canLeft
      ? "left"
      : canBottom
        ? "bottom"
        : "top";

  let dot: Placement["dot"];
  let calloutLeft: number;
  let calloutTop: number;
  let line: Placement["dot"];

  if (side === "right" || side === "left") {
    const dotY = clamp(
      target.top + target.height / 2,
      VIEWPORT_PADDING,
      vh - VIEWPORT_PADDING,
    );
    dot = { x: side === "right" ? target.right : target.left, y: dotY };
    calloutLeft =
      side === "right" ? target.right + GAP : target.left - GAP - CALLOUT_WIDTH;
    calloutTop = clamp(
      dotY - calloutHeight / 2,
      VIEWPORT_PADDING,
      Math.max(VIEWPORT_PADDING, vh - calloutHeight - VIEWPORT_PADDING),
    );
    line = {
      x: side === "right" ? calloutLeft : calloutLeft + CALLOUT_WIDTH,
      y: clamp(dotY, calloutTop, calloutTop + calloutHeight),
    };
  } else {
    const dotX = clamp(
      target.left + target.width / 2,
      VIEWPORT_PADDING,
      vw - VIEWPORT_PADDING,
    );
    dot = { x: dotX, y: side === "bottom" ? target.bottom : target.top };
    calloutLeft = clamp(
      target.left + target.width / 2 - CALLOUT_WIDTH / 2,
      VIEWPORT_PADDING,
      Math.max(VIEWPORT_PADDING, vw - CALLOUT_WIDTH - VIEWPORT_PADDING),
    );
    calloutTop =
      side === "bottom" ? target.bottom + GAP : target.top - GAP - calloutHeight;
    line = {
      x: clamp(dotX, calloutLeft, calloutLeft + CALLOUT_WIDTH),
      y: side === "bottom" ? calloutTop : calloutTop + calloutHeight,
    };
  }

  return {
    side,
    dot,
    line,
    calloutLeft,
    calloutTop,
    ringRect: {
      left: target.left - 4,
      top: target.top - 4,
      width: target.width + 8,
      height: target.height + 8,
    },
  };
}

/**
 * Positions a step's callout against `[data-tutorial-anchor="anchorId"]` on
 * the live page. Renders `fallback` (the centered dialog) instead, once
 * `ANCHOR_WAIT_MS` has passed with no matching element found — a page whose
 * anchors were re-tagged out from under a saved step must never hang here
 * silently or throw.
 */
function AnchoredCallout({
  anchorId,
  open,
  title,
  stepIndex,
  stepCount,
  body,
  footer,
  onClose,
  fallback,
}: {
  anchorId: string;
  open: boolean;
  title: string;
  stepIndex: number;
  stepCount: number;
  body: ReactNode;
  footer: ReactNode;
  onClose: () => void;
  fallback: ReactNode;
}) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [gaveUp, setGaveUp] = useState(false);
  const calloutRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);

  // Re-resolves on every open/step/anchor change — the tagged element may not
  // have mounted yet (its page section can be behind the host page's own
  // pending query) or may already be gone by the time this step is reached.
  useEffect(() => {
    setTarget(null);
    setGaveUp(false);
    if (!open) return;

    let cancelled = false;
    const startedAt = Date.now();

    function look() {
      if (cancelled) return;
      let el: Element | null = null;
      try {
        el = document.querySelector(`[data-tutorial-anchor="${anchorId}"]`);
      } catch {
        el = null;
      }
      if (el instanceof HTMLElement) {
        setTarget(el);
        return;
      }
      if (Date.now() - startedAt >= ANCHOR_WAIT_MS) {
        setGaveUp(true);
        return;
      }
      window.setTimeout(look, ANCHOR_POLL_MS);
    }
    look();

    return () => {
      cancelled = true;
    };
  }, [open, anchorId, stepIndex]);

  useLayoutEffect(() => {
    if (!target || !open) {
      setPlacement(null);
      return;
    }

    function reposition() {
      const height = calloutRef.current?.offsetHeight ?? 140;
      setPlacement(computePlacement(target!.getBoundingClientRect(), height));
    }

    reposition();

    const resizeObserver = new ResizeObserver(reposition);
    resizeObserver.observe(target);
    if (calloutRef.current) resizeObserver.observe(calloutRef.current);

    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [target, open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  if (gaveUp) return fallback;
  // Still polling for the target, or it resolved but hasn't been measured
  // into a placement yet — render nothing rather than flash the fallback
  // and then swap it out a moment later.
  if (!target || !placement) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-50">
      <div
        aria-hidden="true"
        className="absolute rounded-md ring-2 ring-primary transition-[left,top,width,height] duration-150"
        style={{
          left: placement.ringRect.left,
          top: placement.ringRect.top,
          width: placement.ringRect.width,
          height: placement.ringRect.height,
        }}
      />
      <svg aria-hidden="true" className="absolute inset-0 size-full overflow-visible">
        <line
          x1={placement.dot.x}
          y1={placement.dot.y}
          x2={placement.line.x}
          y2={placement.line.y}
          className="stroke-primary"
          strokeWidth={2}
        />
        <circle cx={placement.dot.x} cy={placement.dot.y} r={4} className="fill-primary" />
      </svg>
      <div
        ref={calloutRef}
        role="dialog"
        aria-label={title}
        className="pointer-events-auto absolute flex w-80 flex-col gap-3 rounded-lg bg-popover p-4 text-sm text-popover-foreground ring-1 ring-border shadow-lg"
        style={{ left: placement.calloutLeft, top: placement.calloutTop }}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-heading text-sm font-medium">{title}</p>
            <p className="text-xs text-muted-foreground">
              Step {stepIndex + 1} of {stepCount}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="-mt-1 -mr-1"
            onClick={onClose}
          >
            <X aria-hidden="true" />
            <span className="sr-only">Close</span>
          </Button>
        </div>
        {body}
        {footer}
      </div>
    </div>
  );
}
