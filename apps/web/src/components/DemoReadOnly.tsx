import { Lock } from "lucide-react";
import { DEMO_READ_ONLY_NOTE } from "@ticket/shared";
import { useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { viewerOf } from "@/lib/viewer";

/**
 * Settings a demo session may look at and never change (#326, PRD R5 and R15).
 *
 * Knowledge, the handoff card and the simulator on Pipeline, the eval schedule
 * and "run now", and the tutorial editor all ask this. Each page, panel and
 * dialog asks it itself rather than being handed a prop by whoever mounts it:
 * a prop a new mount site left out would default to writable. A row private to
 * one file takes the answer from the component above it. The API refuses each
 * of those writes to a demo session regardless (`requireAdmin`); this half is
 * UX.
 */
export function useDemoReadOnly(): boolean {
  const { data: session } = useSession();
  return viewerOf(session?.user).demo;
}

/**
 * Why a control is disabled, said beside it. Renders nothing outside a demo
 * session, like `DemoBanner`, so a call site needs no guard of its own.
 */
export function DemoReadOnlyNote({ className }: { className?: string }) {
  if (!useDemoReadOnly()) return null;

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
