import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import type {
  KnowledgeArticle,
  KnowledgeArticleResponse,
} from "@ticket/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import { extractErrorMessage } from "@/lib/errors";
import { knowledgeKeys } from "@/lib/knowledge-queries";

/**
 * Retiring an article, or bringing one back.
 *
 * Confirmed rather than done on a click, and the confirmation says the specific
 * consequence rather than "are you sure?". Archiving an auto-replyable article
 * silently narrows what the desk can answer by itself: tickets that used to be
 * resolved in seconds start landing in the queue, and nothing anywhere connects
 * that to a checkbox somebody touched last Tuesday. Naming it here is the
 * cheapest place to prevent that.
 *
 * There is no delete, here or in the API. Replies already sent cite these ids.
 */
export function KnowledgeArchiveDialog({
  article,
  onOpenChange,
}: {
  article: KnowledgeArticle | null;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const restoring = article?.archived ?? false;

  const mutation = useMutation({
    mutationFn: async (target: KnowledgeArticle) => {
      const { data } = await api.post<KnowledgeArticleResponse>(
        `/api/knowledge-articles/${target.id}/archive`,
        { archived: !target.archived },
      );
      return data;
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: knowledgeKeys.all });
      onOpenChange(false);
      toast.success(
        data.article.archived
          ? `${data.article.id} archived`
          : `${data.article.id} restored`,
      );
    },
    onError: (err) => {
      toast.error(
        extractErrorMessage(
          err,
          restoring ? "Failed to restore" : "Failed to archive",
        ),
      );
    },
  });

  return (
    <Dialog open={article !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {restoring ? "Restore this article?" : "Archive this article?"}
          </DialogTitle>
          <DialogDescription>
            {article?.title}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 text-sm text-muted-foreground">
          {restoring ? (
            <p>
              It goes back into the knowledge base at {article?.id}. It stays
              withheld from the assistant until you turn that on again.
            </p>
          ) : (
            <>
              <p>
                It leaves every future reply prompt. Nothing is deleted:{" "}
                {article?.id} stays readable, because replies already sent to
                customers cite it.
              </p>
              {article?.autoReply && (
                // Only shown when it is true, and it is the sentence that
                // matters: this is the article going out of the machine's
                // reach, not merely off a list.
                <p className="text-foreground">
                  The assistant answers from this article today. Archiving it
                  means those questions start reaching an agent instead.
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            disabled={mutation.isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            variant={restoring ? "default" : "destructive"}
            disabled={mutation.isPending || !article}
            onClick={() => article && mutation.mutate(article)}
          >
            {mutation.isPending && <Loader2 className="size-4 animate-spin" />}
            {restoring ? "Restore article" : "Archive article"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
