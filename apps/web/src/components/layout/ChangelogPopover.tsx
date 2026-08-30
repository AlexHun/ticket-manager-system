import { Megaphone } from "lucide-react";
import { CHANGELOG_ENTRIES, compareVersions } from "@ticket/shared";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Hint } from "@/components/Hint";
import {
  useChangelogStatus,
  useMarkChangelogSeen,
} from "@/lib/changelog-queries";

// Newest version first. A version can carry more than one entry — CI records
// one per feat/fix commit on the merged branch (issue #113) — and `sort` is
// stable, so those keep the order they were recorded in, oldest commit first.
const SORTED_ENTRIES = [...CHANGELOG_ENTRIES].sort((a, b) =>
  compareVersions(b.version, a.version),
);

/**
 * The header's "what's new" popover (issue #94): a `Megaphone` button that
 * carries a dot while the signed-in user has unseen entries, opening onto the
 * generated changelog.
 *
 * Marks seen on open, not on dismiss — unlike the tutorial, which marks seen
 * when a user finishes or closes it because the content itself needs reading
 * first. Here the dot's whole job is "there's something to look at", and
 * opening the list *is* looking at it; nothing inside needs a separate
 * acknowledgement.
 */
export function ChangelogPopover() {
  const { data: shouldShow } = useChangelogStatus();
  const markSeen = useMarkChangelogSeen();

  return (
    <Popover
      onOpenChange={(open) => {
        if (open && shouldShow) markSeen.mutate();
      }}
    >
      <Hint content="What's new">
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="relative">
            <Megaphone aria-hidden="true" />
            {shouldShow && (
              <span
                aria-hidden="true"
                data-testid="changelog-dot"
                className="absolute top-1 right-1 h-2 w-2 rounded-full bg-primary ring-2 ring-background"
              />
            )}
            <span className="sr-only">What's new</span>
          </Button>
        </PopoverTrigger>
      </Hint>
      <PopoverContent align="end" className="w-80">
        <div className="mb-1 text-sm font-medium">What's new</div>
        {SORTED_ENTRIES.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing new yet.</p>
        ) : (
          <ul className="flex max-h-80 flex-col gap-3 overflow-y-auto">
            {SORTED_ENTRIES.map((entry) => (
              <li
                key={`${entry.version}-${entry.title}`}
                className="flex flex-col gap-0.5"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    v{entry.version}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {entry.date}
                  </span>
                </div>
                <p className="text-sm">{entry.title}</p>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
