import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus, Trash2 } from "lucide-react";
import {
  tutorialContentSchema,
  type TutorialContentValues,
} from "@ticket/core";
import {
  TUTORIAL_MAX_STEPS,
  TUTORIAL_STEP_BODY_MAX_LENGTH,
  TUTORIAL_STEP_TITLE_MAX_LENGTH,
  TUTORIAL_TITLE_MAX_LENGTH,
  type TutorialContent,
  type TutorialContentResponse,
} from "@ticket/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import { extractErrorMessage } from "@/lib/errors";
import { tutorialKeys } from "@/lib/tutorial-queries";
import { TUTORIAL_PAGE_LABEL } from "@/lib/tutorial-labels";

/**
 * Writing one page's tutorial.
 *
 * Always an edit, never a create: the row that opens this always exists
 * server-side (`GET /api/tutorials` returns all eight, `defaultContent` filling
 * whichever nobody has written), so there is no separate "new tutorial" mode
 * the way `KnowledgeArticleDialog` has — only "this page's content, possibly
 * still empty."
 *
 * A page with no content starts with one blank step rather than zero, because
 * the schema requires at least one — `steps.length === 0` is reserved for
 * "nobody has saved this page yet" (see `tutorialContentSchema`), not for
 * "the admin chose to say nothing."
 */

const EMPTY_STEP = { title: "", body: "" };

function defaultValuesFor(tutorial: TutorialContent): TutorialContentValues {
  return {
    title: tutorial.title,
    steps: tutorial.steps.length > 0 ? tutorial.steps : [{ ...EMPTY_STEP }],
  };
}

export function TutorialEditorDialog({
  tutorial,
  open,
  onOpenChange,
}: {
  tutorial: TutorialContent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<TutorialContentValues>({
    resolver: zodResolver(tutorialContentSchema),
    defaultValues: { title: "", steps: [{ ...EMPTY_STEP }] },
  });

  const { fields, append, remove } = useFieldArray({ control, name: "steps" });

  useEffect(() => {
    if (!open || !tutorial) return;
    reset(defaultValuesFor(tutorial));
    setServerError(null);
  }, [open, tutorial, reset]);

  const mutation = useMutation({
    mutationFn: async (values: TutorialContentValues) => {
      const { data } = await api.put<TutorialContentResponse>(
        `/api/tutorials/${tutorial!.pageKey}`,
        values,
      );
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: tutorialKeys.list });
      setServerError(null);
      onOpenChange(false);
      toast.success(`${TUTORIAL_PAGE_LABEL[tutorial!.pageKey]} tutorial saved`);
    },
    onError: (err) => {
      const message = extractErrorMessage(err, "Failed to save the tutorial");
      setServerError(message);
      toast.error(message);
    },
  });

  if (!tutorial) return null;

  const idPrefix = `tutorial-${tutorial.pageKey}`;
  const label = TUTORIAL_PAGE_LABEL[tutorial.pageKey];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setServerError(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            Shown once to a user who has not seen this page's tutorial yet, or
            whose version is out of date. Editing the wording here never
            re-triggers it — only a developer bumping the page's version does
            that.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit((values) => {
            setServerError(null);
            mutation.mutate(values);
          })}
          noValidate
          className="flex flex-col gap-5"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${idPrefix}-title`}>Title</Label>
            <Input
              id={`${idPrefix}-title`}
              aria-invalid={Boolean(errors.title)}
              disabled={isSubmitting}
              maxLength={TUTORIAL_TITLE_MAX_LENGTH}
              {...register("title")}
            />
            {errors.title && (
              <p className="text-sm text-destructive" role="alert">
                {errors.title.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-4">
            {fields.map((field, index) => (
              <div key={field.id} className="rounded-lg border p-4">
                <div className="mb-3 flex items-center justify-between">
                  <Label className="text-sm font-medium">
                    Step {index + 1}
                  </Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isSubmitting || fields.length <= 1}
                    onClick={() => remove(index)}
                  >
                    <Trash2 aria-hidden="true" />
                    Remove
                  </Button>
                </div>

                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`${idPrefix}-step-${index}-title`}>
                      Step {index + 1} title
                    </Label>
                    <Input
                      id={`${idPrefix}-step-${index}-title`}
                      aria-invalid={Boolean(errors.steps?.[index]?.title)}
                      disabled={isSubmitting}
                      maxLength={TUTORIAL_STEP_TITLE_MAX_LENGTH}
                      {...register(`steps.${index}.title`)}
                    />
                    {errors.steps?.[index]?.title && (
                      <p className="text-sm text-destructive" role="alert">
                        {errors.steps[index]?.title?.message}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`${idPrefix}-step-${index}-body`}>
                      Step {index + 1} body
                    </Label>
                    <Textarea
                      id={`${idPrefix}-step-${index}-body`}
                      rows={3}
                      aria-invalid={Boolean(errors.steps?.[index]?.body)}
                      disabled={isSubmitting}
                      maxLength={TUTORIAL_STEP_BODY_MAX_LENGTH}
                      {...register(`steps.${index}.body`)}
                    />
                    {errors.steps?.[index]?.body && (
                      <p className="text-sm text-destructive" role="alert">
                        {errors.steps[index]?.body?.message}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {errors.steps?.message && (
              <p className="text-sm text-destructive" role="alert">
                {errors.steps.message}
              </p>
            )}

            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isSubmitting || fields.length >= TUTORIAL_MAX_STEPS}
              onClick={() => append({ ...EMPTY_STEP })}
            >
              <Plus aria-hidden="true" />
              Add step
            </Button>
          </div>

          {serverError && (
            <p className="text-sm text-destructive" role="alert">
              {serverError}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="size-4 animate-spin" />}
              {isSubmitting ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
