import type { ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowLeft, ArrowRight, GripVertical, Minimize2, Maximize2 } from "lucide-react";
import type { DashboardPanelPlacement } from "@ticket/shared";
import { Button } from "@/components/ui/button";
import { DASHBOARD_PANEL_LABEL } from "@/lib/dashboard-panels";
import { cn } from "@/lib/utils";
import { PANEL_SPAN } from "./grid";

/**
 * One panel's grid slot, in and out of customize mode.
 *
 * `useSortable` is what moves the whole slot as an array reorder — pointer
 * drag only, on the grip handle below. There is deliberately no `attributes`
 * spread and no `KeyboardSensor` registered on the `DndContext`: dnd-kit's
 * own keyboard recipe would make the grip a focusable stop that does nothing
 * without arrow-key drag semantics wired up, and this app's other draggable-
 * adjacent controls (the tutorial callout, `AiShine`) don't ask a screen
 * reader user to learn a drag gesture at all. The four labelled buttons next
 * to the grip are the actual keyboard-operable equivalent the ticket asks
 * for — full Tab/Enter support, no drag simulation required — see
 * `DashboardPage` for the handlers they call.
 */
export function DashboardPanelSlot({
  placement,
  customizing,
  isFirst,
  isLast,
  canGrow,
  canShrink,
  onMoveEarlier,
  onMoveLater,
  onGrow,
  onShrink,
  children,
}: {
  placement: DashboardPanelPlacement;
  customizing: boolean;
  isFirst: boolean;
  isLast: boolean;
  canGrow: boolean;
  canShrink: boolean;
  onMoveEarlier: () => void;
  onMoveLater: () => void;
  onGrow: () => void;
  onShrink: () => void;
  children: ReactNode;
}) {
  const { setNodeRef, listeners, transform, transition, isDragging } =
    useSortable({ id: placement.panelId, disabled: !customizing });

  const label = DASHBOARD_PANEL_LABEL[placement.panelId];

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        PANEL_SPAN[placement.width],
        "relative",
        customizing &&
          "rounded-lg outline-2 outline-dashed outline-border outline-offset-4",
        isDragging && "z-10 opacity-70",
      )}
    >
      {customizing && (
        <div className="absolute top-2 right-2 z-10 flex items-center gap-0.5 rounded-md border bg-popover p-1 shadow-sm">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Move ${label} earlier`}
            disabled={isFirst}
            onClick={onMoveEarlier}
          >
            <ArrowLeft aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Move ${label} later`}
            disabled={isLast}
            onClick={onMoveLater}
          >
            <ArrowRight aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Shrink ${label}`}
            disabled={!canShrink}
            onClick={onShrink}
          >
            <Minimize2 aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Grow ${label}`}
            disabled={!canGrow}
            onClick={onGrow}
          >
            <Maximize2 aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Drag to reorder ${label}`}
            className="cursor-grab active:cursor-grabbing"
            {...listeners}
          >
            <GripVertical aria-hidden="true" />
          </Button>
        </div>
      )}
      {children}
    </div>
  );
}
