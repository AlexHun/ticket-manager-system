import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import type { TutorialContent, TutorialContentsResponse } from "@ticket/shared";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { extractErrorMessage } from "@/lib/errors";
import { tutorialKeys } from "@/lib/tutorial-queries";
import { TUTORIAL_PAGE_LABEL } from "@/lib/tutorial-labels";
import { TutorialEditorDialog } from "./TutorialEditorDialog";

/**
 * The tutorial editor, at `/tutorials` — admin only.
 *
 * One row per page, fixed at eight and always all eight: unlike the knowledge
 * base, nothing here is created or archived, only written. A page with no
 * content yet is not missing from the list, it is a row that says so — the
 * same "steps.length === 0" state `GET /api/tutorials/:pageKey` reads as
 * "nothing to show" (see `defaultContent` in that route), spelled out here so
 * an admin can tell "not written" from "written, but empty" is not a state
 * this screen can produce.
 */

function useTutorials() {
  return useQuery({
    queryKey: tutorialKeys.list,
    queryFn: async ({ signal }) => {
      const { data } = await api.get<TutorialContentsResponse>(
        "/api/tutorials",
        { signal },
      );
      return data.tutorials;
    },
  });
}

export function TutorialsPage() {
  const { data: tutorials, isPending, error } = useTutorials();
  const [editing, setEditing] = useState<TutorialContent | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const openEdit = (tutorial: TutorialContent) => {
    setEditing(tutorial);
    setDialogOpen(true);
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <div className="max-w-5xl">
        <PageHeader
          title="Tutorials"
          description="What each page teaches a user the first time they land on it."
        />

        {isPending && <TutorialsSkeleton />}

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {extractErrorMessage(error, "Failed to load the tutorials")}
          </p>
        )}

        {tutorials && (
          <ul className="flex flex-col gap-2">
            {tutorials.map((tutorial) => (
              <TutorialRow
                key={tutorial.pageKey}
                tutorial={tutorial}
                onEdit={() => openEdit(tutorial)}
              />
            ))}
          </ul>
        )}
      </div>

      <TutorialEditorDialog
        tutorial={editing}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}

function TutorialRow({
  tutorial,
  onEdit,
}: {
  tutorial: TutorialContent;
  onEdit: () => void;
}) {
  const written = tutorial.steps.length > 0;

  return (
    <li className="rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h2 className="font-heading text-base font-semibold">
              {TUTORIAL_PAGE_LABEL[tutorial.pageKey]}
            </h2>
            {written ? (
              <Badge variant="outline" className="border-border text-foreground/70">
                {tutorial.steps.length}{" "}
                {tutorial.steps.length === 1 ? "step" : "steps"}
              </Badge>
            ) : (
              <Badge variant="outline" className="border-dashed text-muted-foreground">
                Not written yet
              </Badge>
            )}
          </div>
          {written ? (
            <p className="text-sm text-muted-foreground">{tutorial.title}</p>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              Nothing is shown to users on this page until it is written.
            </p>
          )}
          {tutorial.updatedAt && (
            <p className="mt-1 text-xs text-muted-foreground">
              Updated {new Date(tutorial.updatedAt).toLocaleDateString()}
              {tutorial.updatedByName ? ` by ${tutorial.updatedByName}` : ""}
            </p>
          )}
        </div>

        <Button variant="ghost" size="sm" onClick={onEdit}>
          <Pencil aria-hidden="true" />
          Edit
        </Button>
      </div>
    </li>
  );
}

function TutorialsSkeleton() {
  return (
    <ul className="flex flex-col gap-2" aria-busy="true" aria-label="Loading tutorials">
      {Array.from({ length: 4 }).map((_, i) => (
        <li key={i} className="rounded-lg border p-4">
          <Skeleton className="mb-2 h-4 w-40" />
          <Skeleton className="h-4 w-2/3" />
        </li>
      ))}
    </ul>
  );
}
