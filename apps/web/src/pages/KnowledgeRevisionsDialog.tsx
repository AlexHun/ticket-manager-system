import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  KNOWLEDGE_REVISION_ACTION,
  KNOWLEDGE_REVISION_STATUS,
  type KnowledgeArticle,
  type KnowledgeArticleRevision,
  type KnowledgeArticleRevisionsResponse,
  type KnowledgeRevisionAction,
  type KnowledgeRevisionApprovalResponse,
  type KnowledgeRevisionRejectionResponse,
} from "@ticket/shared";
import { Hint } from "@/components/Hint";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { extractErrorMessage } from "@/lib/errors";
import { knowledgeKeys } from "@/lib/knowledge-queries";

/**
 * One article's history, and — when there is one — the pending revision
 * awaiting a second admin.
 *
 * This is the feature the whole table exists for. The knowledge base used to be
 * a markdown file, and the argument for keeping it one — made in that file's own
 * header — was that a file is reviewable in a pull request and cannot be edited
 * by whoever talks their way into an admin session. Moving it into the database
 * traded that for an admin screen, and this is the other half of the trade: who
 * changed what, when, kept per article and readable by the people who have to
 * answer for what the desk told a customer.
 *
 * The resolved list shows the article *as it stood after* each change rather
 * than a diff. The question it answers is "what did the prompt say when that
 * reply went out", which is about one moment, not about a sequence — and a diff
 * chain is only as trustworthy as every link in it. A **pending** revision is
 * the opposite case — nothing happened yet — so that one *is* shown as a diff
 * against the live article, which is the only way to answer "what would this
 * change" before anyone approves it.
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

  // At most one, by construction — `PATCH /:id` refuses a second proposal
  // while one is outstanding. Newest first, so it is always the head of the
  // list when it exists.
  const pending = revisions?.find(
    (r) => r.status === KNOWLEDGE_REVISION_STATUS.pending,
  );
  const resolved = revisions?.filter(
    (r) => r.status !== KNOWLEDGE_REVISION_STATUS.pending,
  );

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

        {article && pending && (
          <PendingRevisionCard article={article} revision={pending} />
        )}

        {resolved && resolved.length > 0 && (
          <ol className="flex flex-col gap-3">
            {resolved.map((revision) => (
              <RevisionRow key={revision.id} revision={revision} />
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The fields a proposal can change, and what to call each on this screen. */
const DIFF_FIELD_LABEL = {
  title: "Question",
  category: "Category",
  body: "Answer",
  internalNote: "Internal note",
  autoReply: "Auto-reply",
} as const;

type DiffField = keyof typeof DIFF_FIELD_LABEL;

function fieldText(field: DiffField, value: string | boolean | null): string {
  if (field === "autoReply") return value ? "On" : "Off";
  if (field === "internalNote") return (value as string | null) ?? "(none)";
  return String(value);
}

function changedFields(
  article: KnowledgeArticle,
  revision: KnowledgeArticleRevision,
): DiffField[] {
  return (Object.keys(DIFF_FIELD_LABEL) as DiffField[]).filter(
    (field) => article[field] !== revision[field],
  );
}

/**
 * The one thing this whole chain exists to let an admin do: see what a
 * proposal would change, and say yes or no.
 *
 * Only the fields that actually differ are shown — a proposal that only flips
 * `autoReply` should not force a reviewer to re-read an unchanged answer to
 * find that out.
 */
function PendingRevisionCard({
  article,
  revision,
}: {
  article: KnowledgeArticle;
  revision: KnowledgeArticleRevision;
}) {
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  // The rule this whole step exists for: the admin who submitted a proposal
  // cannot be the one who approves it. `editorId` never reaches the client
  // (see the type's own note), so email — unique per account — stands in for
  // it here; the server holds the actual id comparison.
  const isOwnRevision = session?.user.email === revision.editorEmail;

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: knowledgeKeys.all });

  const approve = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<KnowledgeRevisionApprovalResponse>(
        `/api/knowledge-articles/${article.id}/revisions/${revision.id}/approve`,
      );
      return data;
    },
    onSuccess: (data) => {
      void invalidate();
      toast.success(`${data.article.id} updated — the revision is now live`);
    },
    onError: (err) => {
      toast.error(extractErrorMessage(err, "Failed to approve the revision"));
    },
  });

  const reject = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<KnowledgeRevisionRejectionResponse>(
        `/api/knowledge-articles/${article.id}/revisions/${revision.id}/reject`,
      );
      return data;
    },
    onSuccess: () => {
      void invalidate();
      toast.success("Revision rejected");
    },
    onError: (err) => {
      toast.error(extractErrorMessage(err, "Failed to reject the revision"));
    },
  });

  const busy = approve.isPending || reject.isPending;
  const diff = changedFields(article, revision);

  return (
    <div className="mb-4 rounded-lg border border-status-warning/40 bg-status-warning-soft/40 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge
          variant="outline"
          className="border-transparent bg-status-warning-soft text-status-warning"
        >
          Awaiting approval
        </Badge>
        <span className="text-sm">
          Proposed by <span className="font-medium">{revision.editorName}</span>
        </span>
        <time
          dateTime={revision.createdAt}
          className="ml-auto text-xs text-muted-foreground"
        >
          {new Date(revision.createdAt).toLocaleString()}
        </time>
      </div>

      <dl className="flex flex-col gap-3">
        {diff.map((field) => (
          <div key={field}>
            <dt className="text-xs font-medium text-muted-foreground">
              {DIFF_FIELD_LABEL[field]}
            </dt>
            <dd className="mt-0.5 text-sm">
              <span className="text-muted-foreground line-through">
                {fieldText(field, article[field])}
              </span>
              <span className="mx-2 text-muted-foreground">→</span>
              <span>{fieldText(field, revision[field])}</span>
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => reject.mutate()}
        >
          {reject.isPending && <Loader2 className="size-4 animate-spin" />}
          Reject
        </Button>
        <Hint
          content={
            isOwnRevision
              ? "You submitted this — a different admin has to approve it"
              : ""
          }
        >
          <span className="inline-flex">
            <Button
              type="button"
              size="sm"
              disabled={busy || isOwnRevision}
              onClick={() => approve.mutate()}
            >
              {approve.isPending && (
                <Loader2 className="size-4 animate-spin" />
              )}
              Approve
            </Button>
          </span>
        </Hint>
      </div>
    </div>
  );
}

function RevisionRow({ revision }: { revision: KnowledgeArticleRevision }) {
  return (
    <li className="rounded-lg border p-3">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={ACTION_CLASS[revision.action]}>
          {ACTION_LABEL[revision.action]}
        </Badge>
        {revision.status === KNOWLEDGE_REVISION_STATUS.rejected && (
          <Badge
            variant="outline"
            className="border-transparent bg-destructive/10 text-destructive"
          >
            Rejected
          </Badge>
        )}
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
        {/* Who closed the review, when this one went through a second admin
            rather than applying by default. */}
        {revision.approvedByName && (
          <span>
            {revision.status === KNOWLEDGE_REVISION_STATUS.rejected
              ? "Rejected"
              : "Approved"}{" "}
            by {revision.approvedByName}
          </span>
        )}
      </div>
    </li>
  );
}
