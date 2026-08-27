import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArchiveRestore, History, Pencil, Sparkles } from "lucide-react";
import { TUTORIAL_PAGE_KEY } from "@ticket/shared";
import type {
  KnowledgeArticle,
  KnowledgeArticleRevisionsResponse,
  KnowledgeArticlesResponse,
} from "@ticket/shared";
import { CategoryBadge } from "@/components/TicketBadges";
import { Hint } from "@/components/Hint";
import { Tutorial } from "@/components/Tutorial";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Toggle } from "@/components/ui/toggle";
import { api } from "@/lib/api";
import { extractErrorMessage } from "@/lib/errors";
import { knowledgeKeys } from "@/lib/knowledge-queries";
import { KnowledgeArchiveDialog } from "./KnowledgeArchiveDialog";
import { KnowledgeArticleDialog } from "./KnowledgeArticleDialog";
import { KnowledgeRevisionsDialog } from "./KnowledgeRevisionsDialog";

/**
 * The knowledge base, at `/knowledge` — admin only.
 *
 * This is the screen the auto-reply's whole safety story rests on. Six checks
 * sit between a model and a customer, and five of them are checks on what the
 * model *produced*; the first gate — which articles it is ever shown — is
 * decided here, by a person, in the `Auto-reply` column. Everything about this
 * page is built to make that one fact legible: it is the first thing in a row,
 * it is a labelled switch rather than a checkbox in a corner, and it has its own
 * count in the header so an admin can see at a glance how much of the corpus a
 * machine is allowed to speak from.
 *
 * The page shows archived articles too, behind a toggle rather than on a
 * separate screen. An admin looking for an article that "should be here" needs
 * to find it retired rather than conclude it never existed and write a second
 * copy — which is how a knowledge base ends up with two answers to one question,
 * one of them wrong.
 */

function useKnowledgeArticles() {
  return useQuery({
    queryKey: knowledgeKeys.list,
    queryFn: async ({ signal }) => {
      const { data } = await api.get<KnowledgeArticlesResponse>(
        "/api/knowledge-articles",
        { signal },
      );
      return data.articles;
    },
  });
}

/**
 * Every pending revision across the corpus, keyed by article — the map that
 * lets a list of articles say "this one has a proposal waiting" without a
 * request per row.
 */
function usePendingRevisions() {
  return useQuery({
    queryKey: knowledgeKeys.pending,
    queryFn: async ({ signal }) => {
      const { data } = await api.get<KnowledgeArticleRevisionsResponse>(
        "/api/knowledge-articles/pending-revisions",
        { signal },
      );
      return new Map(data.revisions.map((r) => [r.articleId, r]));
    },
  });
}

export function KnowledgePage() {
  const { data: articles, isPending, error } = useKnowledgeArticles();
  const { data: pendingByArticle } = usePendingRevisions();

  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<KnowledgeArticle | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [archiving, setArchiving] = useState<KnowledgeArticle | null>(null);
  const [historyOf, setHistoryOf] = useState<KnowledgeArticle | null>(null);

  const visible = useMemo(
    () => (articles ?? []).filter((a) => showArchived || !a.archived),
    [articles, showArchived],
  );

  const answerable = (articles ?? []).filter(
    (a) => a.autoReply && !a.archived,
  ).length;
  const archived = (articles ?? []).filter((a) => a.archived).length;

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (article: KnowledgeArticle) => {
    setEditing(article);
    setDialogOpen(true);
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <Tutorial pageKey={TUTORIAL_PAGE_KEY.knowledge} />

      <div className="max-w-5xl">
        <PageHeader
          title="Knowledge base"
          description="What the support desk knows, and which of it a machine may answer from unattended."
        >
          {archived > 0 && (
            <Toggle
              variant="outline"
              size="sm"
              pressed={showArchived}
              onPressedChange={setShowArchived}
            >
              Show archived ({archived})
            </Toggle>
          )}
          <div data-tutorial-anchor="new" className="contents">
            <Button onClick={openCreate}>New article</Button>
          </div>
        </PageHeader>

        {/* The number that matters, stated rather than counted off the list. An
            admin's real question on arriving here is "how much of this can the
            machine say?", and it is not answerable by looking at a column of
            switches. */}
        {articles && (
          <p
            data-tutorial-anchor="answerable"
            className="mb-4 text-sm text-muted-foreground"
          >
            <span className="font-medium text-foreground">{answerable}</span> of{" "}
            {articles.length - archived} live articles are available to the
            auto-reply. The rest are for agents to answer from.
          </p>
        )}

        {isPending && <KnowledgeSkeleton />}

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {extractErrorMessage(error, "Failed to load the knowledge base")}
          </p>
        )}

        {articles && visible.length === 0 && (
          <p className="rounded-lg border border-dashed py-10 text-center font-display text-lg text-muted-foreground">
            Nothing here yet. The first article is the first thing the desk can
            answer by itself.
          </p>
        )}

        {visible.length > 0 && (
          <ul className="flex flex-col gap-2">
            {visible.map((article) => (
              <ArticleRow
                key={article.id}
                article={article}
                pending={pendingByArticle?.has(article.id) ?? false}
                onEdit={() => openEdit(article)}
                onArchive={() => setArchiving(article)}
                onHistory={() => setHistoryOf(article)}
              />
            ))}
          </ul>
        )}
      </div>

      <KnowledgeArticleDialog
        article={editing}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
      <KnowledgeArchiveDialog
        article={archiving}
        onOpenChange={(open) => {
          if (!open) setArchiving(null);
        }}
      />
      <KnowledgeRevisionsDialog
        article={historyOf}
        onOpenChange={(open) => {
          if (!open) setHistoryOf(null);
        }}
      />
    </div>
  );
}

/**
 * One article, as a card rather than a table row.
 *
 * A table was the obvious shape and the wrong one: the body is the article, it
 * is a paragraph rather than a value, and squeezing it into a cell would either
 * truncate the thing being reviewed or make every row four lines tall anyway.
 * The card shows enough of the answer to recognise it and puts the two facts
 * that rank an article — whether a machine may use it, and whether it is still
 * live — where the eye lands first.
 */
function ArticleRow({
  article,
  pending,
  onEdit,
  onArchive,
  onHistory,
}: {
  article: KnowledgeArticle;
  /** Whether a revision on this article is awaiting a second admin. */
  pending: boolean;
  onEdit: () => void;
  onArchive: () => void;
  onHistory: () => void;
}) {
  return (
    <li
      className={
        article.archived
          ? "rounded-lg border border-dashed p-4 opacity-60"
          : "rounded-lg border p-4"
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            {/* Geist, not a monospace. The type system here runs to exactly two
                roles — the serif for the customer's own words, the sans for
                everything else — and a third face introduced for six characters
                would be a new role bought at the price of the distinction the
                first two are making. */}
            <span className="text-xs tabular-nums text-muted-foreground">
              {article.id}
            </span>
            <CategoryBadge category={article.category} />
            {article.autoReply && !article.archived && (
              // The one badge on this page that is not neutral. It marks the
              // articles a machine may answer customers from with nobody
              // reading the result, which is the most consequential state
              // anything on this screen can be in.
              <Badge
                variant="outline"
                className="border-transparent bg-ember-1/15 text-ember-1"
              >
                <Sparkles aria-hidden="true" className="size-3" />
                Auto-reply
              </Badge>
            )}
            {article.archived && (
              <Badge variant="outline" className="border-border text-foreground/70">
                Archived
              </Badge>
            )}
            {pending && (
              // Names the risk this whole review step exists for: an edit
              // sitting here has not reached a customer yet, whatever the
              // rest of the row still shows.
              <Badge
                variant="outline"
                className="border-transparent bg-status-warning-soft text-status-warning"
              >
                Awaiting approval
              </Badge>
            )}
          </div>
          {/* The serif, and the third place it appears. Same argument as the
              ticket subject: this is the customer's question, in the customer's
              words, sitting among the app's own chrome. */}
          <h2 className="font-display text-lg font-semibold wrap-break-word">
            {article.title}
          </h2>
          <p className="mt-1 line-clamp-2 max-w-prose text-sm text-muted-foreground">
            {article.body}
          </p>
          {article.internalNote && (
            <p className="mt-2 max-w-prose border-l-2 border-border pl-3 text-sm text-muted-foreground">
              {/* Marked as staff-only in the interface as well as in the
                  schema. The column never reaches a prompt; this line is so
                  the person reading it knows that without having to ask. */}
              <span className="font-medium text-foreground/80">Internal — </span>
              {article.internalNote}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="sm" onClick={onHistory}>
            <History aria-hidden="true" />
            History
          </Button>
          {!article.archived && (
            <Hint
              content={
                pending
                  ? "Resolve the pending revision before editing again"
                  : ""
              }
            >
              <span className="inline-flex">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={onEdit}
                >
                  <Pencil aria-hidden="true" />
                  Edit
                </Button>
              </span>
            </Hint>
          )}
          <Button variant="ghost" size="sm" onClick={onArchive}>
            <ArchiveRestore aria-hidden="true" />
            {article.archived ? "Restore" : "Archive"}
          </Button>
        </div>
      </div>
    </li>
  );
}

function KnowledgeSkeleton() {
  return (
    <ul className="flex flex-col gap-2" aria-busy="true" aria-label="Loading articles">
      {Array.from({ length: 4 }).map((_, i) => (
        <li key={i} className="rounded-lg border p-4">
          <Skeleton className="mb-2 h-4 w-40" />
          <Skeleton className="mb-2 h-5 w-2/3" />
          <Skeleton className="h-4 w-full max-w-prose" />
        </li>
      ))}
    </ul>
  );
}
