import { useQuery } from "@tanstack/react-query";
import {
  KNOWLEDGE_REVISION_ACTION,
  type KnowledgeArticle,
  type KnowledgeArticleRevision,
  type KnowledgeArticleRevisionsResponse,
  type KnowledgeRevisionAction,
} from "@ticket/shared";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { extractErrorMessage } from "@/lib/errors";
import { knowledgeKeys } from "@/lib/knowledge-queries";

/**
 * One article's history.
 *
 * This is the feature the whole table exists for. The knowledge base used to be
 * a markdown file, and the argument for keeping it one — made in that file's own
 * header — was that a file is reviewable in a pull request and cannot be edited
 * by whoever talks their way into an admin session. Moving it into the database
 * traded that for an admin screen, and this is the other half of the trade: who
 * changed what, when, kept per article and readable by the people who have to
 * answer for what the desk told a customer.
 *
 * The list shows the article *as it stood after* each change rather than a diff.
 * The question it answers is "what did the prompt say when that reply went out",
 * which is about one moment, not about a sequence — and a diff chain is only as
 * trustworthy as every link in it.
 */

const ACTION_LABEL: Record<KnowledgeRevisionAction, string> = {
  [KNOWLEDGE_REVISION_ACTION.created]: "Created",
  [KNOWLEDGE_REVISION_ACTION.updated]: "Edited",
  [KNOWLEDGE_REVISION_ACTION.archived]: "Archived",
  [KNOWLEDGE_REVISION_ACTION.restored]: "Restored",
};

/**
 * Archiving and restoring are marked; creating and editing are not.
 *
 * Ember is reserved for the two entries that change what the machine can say
 * without changing a word of what the article says — the ones somebody scrolling
 * this list is looking for.
 */
const ACTION_CLASS: Record<KnowledgeRevisionAction, string> = {
  [KNOWLEDGE_REVISION_ACTION.created]: "border-transparent bg-muted text-muted-foreground",
  [KNOWLEDGE_REVISION_ACTION.updated]: "border-transparent bg-muted text-muted-foreground",
  [KNOWLEDGE_REVISION_ACTION.archived]: "border-transparent bg-ember-2/15 text-ember-2",
  [KNOWLEDGE_REVISION_ACTION.restored]: "border-transparent bg-calm/12 text-calm",
};

function useRevisions(id: string | undefined) {
  return useQuery({
    queryKey: knowledgeKeys.revisions(id ?? ""),
    queryFn: async ({ signal }) => {
      const { data } = await api.get<KnowledgeArticleRevisionsResponse>(
        `/api/knowledge-articles/${id}/revisions`,
        { signal },
      );
      return data.revisions;
    },
    enabled: id !== undefined,
  });
}

export function KnowledgeRevisionsDialog({
  article,
  onOpenChange,
}: {
  article: KnowledgeArticle | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: revisions, isPending, error } = useRevisions(article?.id);

  return (
    <Dialog open={article !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>History of {article?.id}</DialogTitle>
          <DialogDescription>
            Every change to this article, newest first.
          </DialogDescription>
        </DialogHeader>

        {article && isPending && (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {extractErrorMessage(error, "Failed to load the history")}
          </p>
        )}

        {revisions && (
          <ol className="flex flex-col gap-3">
            {revisions.map((revision) => (
              <RevisionRow key={revision.id} revision={revision} />
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RevisionRow({ revision }: { revision: KnowledgeArticleRevision }) {
  return (
    <li className="rounded-lg border p-3">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={ACTION_CLASS[revision.action]}>
          {ACTION_LABEL[revision.action]}
        </Badge>
        <span className="text-sm font-medium">{revision.editorName}</span>
        {/* Null for the one-time import from knowledge-base.md, which had no
            account behind it — so the row says who without inventing an
            address for a script. */}
        {revision.editorEmail && (
          <span className="text-xs text-muted-foreground">
            {revision.editorEmail}
          </span>
        )}
        <time
          dateTime={revision.createdAt}
          className="ml-auto text-xs text-muted-foreground"
        >
          {new Date(revision.createdAt).toLocaleString()}
        </time>
      </div>

      <p className="text-sm">{revision.title}</p>
      <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">
        {revision.body}
      </p>

      <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span>{revision.category}</span>
        {/* The state of the switch at this revision, spelled out. It is the
            field an audit of this feature is actually auditing. */}
        <span className={revision.autoReply ? "text-ember-1" : undefined}>
          {revision.autoReply
            ? "Available to the auto-reply"
            : "Withheld from the auto-reply"}
        </span>
        {revision.internalNote && <span>Has an internal note</span>}
      </div>
    </li>
  );
}
