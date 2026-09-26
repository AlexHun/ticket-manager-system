import { Lock } from "lucide-react";
import { DEMO_READ_ONLY_NOTE } from "@ticket/shared";
import { useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { viewerOf } from "@/lib/viewer";

/**
 * Settings a demo session may look at and never change (#326, PRD R5 and R15).
 *
 * Knowledge, the handoff card and the simulator on Pipeline, the eval schedule
 * and "run now", and the tutorial editor all ask this, and each asks it itself
 * rather than being handed a prop by its page: the dialogs and panels that hold
 * the controls are mounted from several places, and a prop somebody forgot to
 * pass would default to writable. The API refuses each of those writes to a
 * demo session regardless (`requireAdmin`); this half is UX.
 */
export function useDemoReadOnly(): boolean {
  const { data: session } = useSession();
  return viewerOf(session?.user).demo;
}

/** Why a control is disabled, said beside it. Render it only when read-only. */
export function DemoReadOnlyNote({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        "flex items-center gap-1.5 text-xs text-muted-foreground",
        className,
      )}
    >
      <Lock aria-hidden="true" className="size-3.5 shrink-0" />
      {DEMO_READ_ONLY_NOTE}
    </p>
  );
}
