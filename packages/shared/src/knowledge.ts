import type { TicketCategory } from "./tickets.ts";

/**
 * What happened to a knowledge-base article, for the audit trail.
 *
 * Four actions rather than a create/update pair, because archiving is the thing
 * this system does *instead* of deleting and it is the single most consequential
 * edit on the screen — an archived article leaves every future prompt. Reading a
 * revision list, "archived" and "restored" are the entries you are looking for.
 */
export const KNOWLEDGE_REVISION_ACTION = {
  created: "created",
  updated: "updated",
  archived: "archived",
  restored: "restored",
} as const;

export type KnowledgeRevisionAction =
  (typeof KNOWLEDGE_REVISION_ACTION)[keyof typeof KNOWLEDGE_REVISION_ACTION];

/**
 * Where a revision sits in the approval workflow. `approved` is also the
 * default for a revision an edit applied immediately — an article not (yet)
 * flagged for auto-reply needs no second admin, so its edits still take effect
 * on write, exactly as every edit did before this existed.
 */
export const KNOWLEDGE_REVISION_STATUS = {
  pending: "pending",
  approved: "approved",
  rejected: "rejected",
} as const;

export type KnowledgeRevisionStatus =
  (typeof KNOWLEDGE_REVISION_STATUS)[keyof typeof KNOWLEDGE_REVISION_STATUS];

/**
 * A knowledge-base article, as the admin screen sees it.
 *
 * **This type carries `internalNote` and the corpus type in the API does not.**
 * That is the whole shape of the feature: `KbArticle` in
 * `apps/api/src/ai/knowledge-base.ts` is what a model is given and has no such
 * field, so the note cannot reach a prompt even by accident. Here it is the
 * point — the guidance about what not to promise and when to escalate is written
 * for the people on this screen.
 *
 * Which also means this type must never be served to anyone but an admin.
 */
export interface KnowledgeArticle {
  /** `KB-001`. Stable, never reused: replies already sent cite it. */
  id: string;
  title: string;
  category: TicketCategory;
  /** The customer-safe answer — the only part a model is ever shown. */
  body: string;
  /** Guidance for staff. Never sent to a model, never quoted to a customer. */
  internalNote: string | null;
  /** Whether the unattended auto-reply may answer from this article. */
  autoReply: boolean;
  /** Retired: out of every prompt, still resolvable by the replies that cite it. */
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * One recorded change, as the trail renders it.
 *
 * `editorName` and `editorEmail` are the denormalised copies stored on the
 * revision, not a join to a live user — the trail has to stay readable after
 * someone's account is deleted, which is exactly when it tends to be read.
 * `editorEmail` is null for the one-time import from `knowledge-base.md`, which
 * had no account behind it.
 */
export interface KnowledgeArticleRevision {
  id: number;
  articleId: string;
  action: KnowledgeRevisionAction;
  title: string;
  category: TicketCategory;
  body: string;
  internalNote: string | null;
  autoReply: boolean;
  archived: boolean;
  editorName: string;
  editorEmail: string | null;
  /** Pending, approved, or turned down. See `KNOWLEDGE_REVISION_STATUS`. */
  status: KnowledgeRevisionStatus;
  /**
   * Who closed out the review, and when — set on an actual approve or reject,
   * never backfilled to match `status`. Both null for a `pending` revision and
   * for one that is `approved` only because no review was needed.
   */
  approvedByName: string | null;
  approvedAt: string | null;
  createdAt: string;
}

export interface KnowledgeArticlesResponse {
  articles: KnowledgeArticle[];
}

export interface KnowledgeArticleResponse {
  article: KnowledgeArticle;
}

/**
 * The result of submitting an edit. `pendingRevision` is null when the edit
 * applied immediately (`article` reflects it); otherwise `article` is
 * unchanged and `pendingRevision` is the proposal now awaiting a second
 * admin — see `docs/adr` and issue #17 for why an auto-replyable article's
 * edits take this path.
 */
export interface KnowledgeArticleEditResponse {
  article: KnowledgeArticle;
  pendingRevision: KnowledgeArticleRevision | null;
}

export interface KnowledgeArticleRevisionsResponse {
  revisions: KnowledgeArticleRevision[];
}

/** A pending revision approved: the live article and the closed-out revision. */
export interface KnowledgeRevisionApprovalResponse {
  article: KnowledgeArticle;
  revision: KnowledgeArticleRevision;
}

/** A pending revision turned down: the article is untouched. */
export interface KnowledgeRevisionRejectionResponse {
  revision: KnowledgeArticleRevision;
}

/** Ceilings on what an admin may write into a prompt. See `knowledgeArticleSchema`. */
export const KB_TITLE_MAX_LENGTH = 200;
export const KB_BODY_MAX_LENGTH = 4_000;
export const KB_INTERNAL_NOTE_MAX_LENGTH = 2_000;
