import type { ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowLeft,
  ArrowRight,
  GripVertical,
  Minimize2,
  Maximize2,
  type LucideIcon,
} from "lucide-react";
import type { DashboardPanelPlacement } from "@ticket/shared";
import { Button } from "@/components/ui/button";
import {
  DASHBOARD_PANEL_COMMAND,
  DASHBOARD_PANEL_LABEL,
  type DashboardPanelCapabilities,
  type DashboardPanelCommand,
} from "@/lib/dashboard-panels";
import { cn } from "@/lib/utils";
import { PANEL_SPAN } from "./grid";

/** The toolbar, as data: one row per command, in the order they appear. The
 * `aria-label`s are the only handle anything has on these buttons — both the
 * component tests and `tests/e2e/dashboard-layout.spec.ts` name them — so the
 * label builder lives here rather than being spelled out per button. */
const PANEL_COMMAND_BUTTONS: {
  command: DashboardPanelCommand;
  icon: LucideIcon;
  label: (panel: string) => string;
}[] = [
  {
    command: DASHBOARD_PANEL_COMMAND.moveEarlier,
    icon: ArrowLeft,
    label: (panel) => `Move ${panel} earlier`,
  },
  {
    command: DASHBOARD_PANEL_COMMAND.moveLater,
    icon: ArrowRight,
    label: (panel) => `Move ${panel} later`,
  },
  {
    command: DASHBOARD_PANEL_COMMAND.shrink,
    icon: Minimize2,
    label: (panel) => `Shrink ${panel}`,
  },
  {
    command: DASHBOARD_PANEL_COMMAND.grow,
    icon: Maximize2,
    label: (panel) => `Grow ${panel}`,
  },
];

/**
 * One panel's grid slot, in and out of customize mode.
 *
 * It knows where the panel sits (`placement`), what moving it from there could
 * achieve (`capabilities`, from `panelCapabilities`), and how to ask for one —
 * and nothing about the array the answers came from. Deciding which command a
 * button sends is the whole of its involvement in the layout; what a command
 * does to the layout is `applyPanelCommand`, in `@/lib/dashboard-panels`.
 *
 * `useSortable` is what moves the whole slot as an array reorder — pointer
 * drag only, on the grip handle below. There is deliberately no `attributes`
 * spread and no `KeyboardSensor` registered on the `DndContext`: dnd-kit's
 * own keyboard recipe would make the grip a focusable stop that does nothing
 * without arrow-key drag semantics wired up, and this app's other draggable-
 * adjacent controls (the tutorial callout, `AiShine`) don't ask a screen
 * reader user to learn a drag gesture at all. The four labelled buttons next
 * to the grip are the actual keyboard-operable equivalent the ticket asks
 * for — full Tab/Enter support, no drag simulation required.
 */
export function DashboardPanelSlot({
  placement,
  capabilities,
  customizing,
  onCommand,
  children,
}: {
  placement: DashboardPanelPlacement;
  capabilities: DashboardPanelCapabilities;
  customizing: boolean;
  onCommand: (command: DashboardPanelCommand) => void;
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
          {PANEL_COMMAND_BUTTONS.map(({ command, icon: Icon, label: name }) => (
            <Button
              key={command}
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={name(label)}
              disabled={!capabilities[command]}
              onClick={() => onCommand(command)}
            >
              <Icon aria-hidden="true" />
            </Button>
          ))}
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
