import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import {
  knowledgeArticleSchema,
  type KnowledgeArticleValues,
} from "@ticket/core";
import {
  KB_BODY_MAX_LENGTH,
  TICKET_CATEGORY,
  type KnowledgeArticle,
  type KnowledgeArticleEditResponse,
  type KnowledgeArticleResponse,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import { extractErrorMessage } from "@/lib/errors";
import { knowledgeKeys } from "@/lib/knowledge-queries";

/**
 * Writing a knowledge-base article.
 *
 * The form is ordinary; two things about it are not.
 *
 * **The answer and the internal note are separate fields, and the interface says
 * why.** In the markdown file they were one document with `> Internal:` lines a
 * parser stripped out. Here they are two columns, and only one of them is ever
 * put in front of a model — so the labelling is not decoration, it is the only
 * place an author learns which half of what they are typing a customer might
 * read back to them.
 *
 * **The auto-reply switch is the most consequential control in the product**,
 * and it is drawn accordingly: last, alone, with a sentence explaining what
 * turning it on means, and defaulting to off on a new article. It decides
 * whether this text is put in front of a machine that answers customers with
 * nobody reading the result.
 */

const EMPTY: KnowledgeArticleValues = {
  title: "",
  category: TICKET_CATEGORY.General,
  body: "",
  internalNote: "",
  autoReply: false,
};

export function KnowledgeArticleDialog({
  article,
  open,
  onOpenChange,
}: {
  article: KnowledgeArticle | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isEdit = article !== null;
  const [serverError, setServerError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<KnowledgeArticleValues>({
    resolver: zodResolver(knowledgeArticleSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open) return;
    reset(
      article
        ? {
            title: article.title,
            category: article.category,
            body: article.body,
            // The column is nullable and a textarea is not — an article with no
            // note opens with an empty box, not the string "null".
            internalNote: article.internalNote ?? "",
            autoReply: article.autoReply,
          }
        : EMPTY,
    );
    setServerError(null);
  }, [open, article, reset]);

  const mutation = useMutation({
    mutationFn: async (values: KnowledgeArticleValues) => {
      if (article) {
        const { data } = await api.patch<KnowledgeArticleEditResponse>(
          `/api/knowledge-articles/${article.id}`,
          values,
        );
        return data;
      }
      const { data } = await api.post<KnowledgeArticleResponse>(
        "/api/knowledge-articles",
        values,
      );
      return { ...data, pendingRevision: null };
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: knowledgeKeys.all });
      setServerError(null);
      onOpenChange(false);
      if (data.pendingRevision) {
        // Nothing customer-visible moved — say so, rather than "updated",
        // which would read as if the edit already took effect.
        toast.success(
          `${data.article.id} submitted for approval`,
          {
            description:
              "A second admin needs to approve it before it goes live.",
          },
        );
        return;
      }
      toast.success(
        isEdit
          ? `${data.article.id} updated`
          : `${data.article.id} created`,
      );
    },
    onError: (err) => {
      const message = extractErrorMessage(
        err,
        isEdit ? "Failed to save the article" : "Failed to create the article",
      );
      setServerError(message);
      toast.error(message);
    },
  });

  const idPrefix = isEdit ? `edit-${article.id}` : "new-article";
  const bodyLength = watch("body")?.length ?? 0;

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
          <DialogTitle>
            {isEdit ? `Edit ${article.id}` : "New article"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Saving records who changed what, and when."
              : "A new article is withheld from the auto-reply until you say otherwise."}
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
            <Label htmlFor={`${idPrefix}-title`}>Question</Label>
            <Input
              id={`${idPrefix}-title`}
              aria-invalid={Boolean(errors.title)}
              disabled={isSubmitting}
              placeholder="How do I cancel the all-access subscription?"
              {...register("title")}
            />
            <p className="text-xs text-muted-foreground">
              Phrase it the way a customer would ask it — that is what the
              matching is done on.
            </p>
            {errors.title && (
              <p className="text-sm text-destructive" role="alert">
                {errors.title.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={`${idPrefix}-category`}>Category</Label>
            <Controller
              control={control}
              name="category"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={isSubmitting}
                >
                  <SelectTrigger id={`${idPrefix}-category`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(TICKET_CATEGORY).map((category) => (
                      <SelectItem key={category} value={category}>
                        {category}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {/* Stated rather than left to be discovered. Refund is the one
                category the auto-reply refuses outright, in code, whatever this
                article's switch says — an author who does not know that will
                eventually wonder why their refund article never fires. */}
            <p className="text-xs text-muted-foreground">
              Refund articles are never answered automatically, whatever the
              switch below says. That refusal lives in code.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={`${idPrefix}-body`}>Answer</Label>
            <Textarea
              id={`${idPrefix}-body`}
              rows={8}
              aria-invalid={Boolean(errors.body)}
              disabled={isSubmitting}
              {...register("body")}
            />
            <p className="text-xs text-muted-foreground">
              Assume every line of this can be quoted to a customer word for
              word. Specific facts — "14 days", "5–10 business days" — are what
              let a draft be checked against it; "promptly" cannot be.{" "}
              <span className="tabular-nums">
                {bodyLength}/{KB_BODY_MAX_LENGTH}
              </span>
            </p>
            {errors.body && (
              <p className="text-sm text-destructive" role="alert">
                {errors.body.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={`${idPrefix}-note`}>Internal note</Label>
            <Textarea
              id={`${idPrefix}-note`}
              rows={3}
              aria-invalid={Boolean(errors.internalNote)}
              disabled={isSubmitting}
              placeholder="What not to promise, when to escalate, which figure to check first."
              {...register("internalNote")}
            />
            <p className="text-xs text-muted-foreground">
              For agents only. This is never sent to the assistant and never
              quoted to a customer — it is stored in a column the reply prompt
              does not read.
            </p>
            {errors.internalNote && (
              <p className="text-sm text-destructive" role="alert">
                {errors.internalNote.message}
              </p>
            )}
          </div>

          {/* Last, and alone. Everything above changes what an article says;
              this changes who gets to say it. */}
          <Controller
            control={control}
            name="autoReply"
            render={({ field }) => (
              <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
                <div className="min-w-0">
                  <Label htmlFor={`${idPrefix}-auto`} className="text-sm">
                    Let the assistant answer from this
                  </Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    On, this article goes into the prompt that answers newly
                    arrived tickets and sends the reply without anyone reading
                    it. Off, it is only ever read by an agent. Say no whenever
                    the honest answer needs a fact a person has to look up.
                  </p>
                </div>
                <Switch
                  id={`${idPrefix}-auto`}
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  disabled={isSubmitting}
                />
              </div>
            )}
          />

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
              {isEdit
                ? isSubmitting
                  ? "Saving…"
                  : "Save changes"
                : isSubmitting
                  ? "Creating…"
                  : "Create article"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
