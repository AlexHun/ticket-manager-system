import { FlaskConical } from "lucide-react";
import { useSession } from "@/lib/auth-client";
import { useSignOut } from "@/lib/use-sign-out";
import { viewerOf } from "@/lib/viewer";
import { Button } from "@/components/ui/button";

/**
 * The strip across the shell during a demo session (#324, PRD R13): what this
 * is, that it does not keep, and the way out.
 *
 * Renders nothing for anybody else, so `AppShell` mounts it unconditionally.
 * A named `region` rather than a `banner`: it sits inside the shell's `<main>`,
 * where a banner landmark is an accessibility violation (see `AppTopBar`).
 *
 * "Exit demo" is `useSignOut`, the top bar's "Sign out" under the visitor's
 * name for it: the identity stays behind for the nightly reset to remove, and
 * the login page still offers the button.
 */
export function DemoBanner() {
  const { data: session } = useSession();
  const exitDemo = useSignOut();

  if (!viewerOf(session?.user).demo) return null;

  return (
    <section
      aria-label="Demo session"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b bg-status-warning-soft px-3 py-1.5 text-sm"
    >
      <FlaskConical
        aria-hidden="true"
        className="size-4 shrink-0 text-status-warning"
      />
      <p className="min-w-0 flex-1">
        <span className="font-medium">You are in a demo.</span>{" "}
        <span className="text-muted-foreground">
          Other visitors see what you change, and everything resets every night
          at 00:00 UTC.
        </span>
      </p>
      <Button variant="outline" size="xs" onClick={exitDemo}>
        Exit demo
      </Button>
    </section>
  );
}
