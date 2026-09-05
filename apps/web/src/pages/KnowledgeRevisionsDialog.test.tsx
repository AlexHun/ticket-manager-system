import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  KNOWLEDGE_REVISION_ACTION,
  KNOWLEDGE_REVISION_STATUS,
  TICKET_CATEGORY,
  type KnowledgeArticle,
  type KnowledgeArticleRevision,
} from "@ticket/shared";
import { apiStub } from "@/test/api-stub";
import { renderRoutes } from "@/test/render";
import { KnowledgeRevisionsDialog } from "./KnowledgeRevisionsDialog";

vi.mock("@/lib/api", () => import("@/test/api-stub"));

// Approve and reject are separate paths rather than one `post` counter, so
// "the author may reject their own proposal" cannot be satisfied by an approve
// that should never have been possible.
const revisionsGet = apiStub.get("/api/knowledge-articles/:id/revisions");
const approvePost = apiStub.post(
  "/api/knowledge-articles/:id/revisions/:revisionId/approve",
);
const rejectPost = apiStub.post(
  "/api/knowledge-articles/:id/revisions/:revisionId/reject",
);

const mockUseSession = vi.fn();
vi.mock("@/lib/auth-client", () => ({
  useSession: () => mockUseSession(),
}));

const ARTICLE: KnowledgeArticle = {
  id: "KB-002",
  title: "Refund policy",
  category: TICKET_CATEGORY.Refund,
  body: "Refunds are issued within 5 business days.",
  internalNote: null,
  autoReply: true,
  archived: false,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const PENDING_REVISION: KnowledgeArticleRevision = {
  id: 7,
  articleId: "KB-002",
  action: KNOWLEDGE_REVISION_ACTION.updated,
  title: "Refund policy (updated)",
  category: TICKET_CATEGORY.Refund,
  body: "Refunds are issued within 5 business days.",
  internalNote: null,
  autoReply: true,
  archived: false,
  editorName: "Ada Admin",
  editorEmail: "ada@example.com",
  status: KNOWLEDGE_REVISION_STATUS.pending,
  approvedByName: null,
  approvedAt: null,
  createdAt: "2026-08-23T09:00:00.000Z",
};

function renderDialog(article: KnowledgeArticle | null = ARTICLE) {
  return renderRoutes([
    {
      path: "/",
      element: <KnowledgeRevisionsDialog article={article} onOpenChange={() => {}} />,
    },
  ]);
}

beforeEach(() => {
  apiStub.reset();
  mockUseSession.mockReturnValue({
    data: { user: { email: "bo@example.com" } },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("KnowledgeRevisionsDialog — a pending revision", () => {
  test("shows it as awaiting approval, diffing only the fields that changed", async () => {
    revisionsGet.mockResolvedValue({ data: { revisions: [PENDING_REVISION] } });

    renderDialog();

    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Awaiting approval");
    expect(within(dialog).getByText("Ada Admin")).toBeInTheDocument();

    // The title changed — both sides of the diff are shown.
    expect(within(dialog).getByText("Refund policy")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Refund policy (updated)"),
    ).toBeInTheDocument();

    // The body did not change — it should not be repeated as a diff row.
    expect(
      within(dialog).queryByText("Refunds are issued within 5 business days."),
    ).not.toBeInTheDocument();
  });

  test("disables Approve and explains why when the viewer submitted it themselves", async () => {
    mockUseSession.mockReturnValue({
      data: { user: { email: "ada@example.com" } },
    });
    revisionsGet.mockResolvedValue({ data: { revisions: [PENDING_REVISION] } });

    renderDialog();
    const dialog = await screen.findByRole("dialog");

    const approveButton = await within(dialog).findByRole("button", {
      name: "Approve",
    });
    expect(approveButton).toBeDisabled();

    // Hover the wrapping span, not the button: a disabled shadcn Button sets
    // `pointer-events: none` and never fires the hover Radix listens for.
    const user = userEvent.setup();
    await user.hover(approveButton.parentElement!);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "You submitted this — a different admin has to approve it",
    );

    expect(
      within(dialog).getByRole("button", { name: "Reject" }),
    ).not.toBeDisabled();
  });

  test("a different admin can approve, which posts to the approve route", async () => {
    revisionsGet.mockResolvedValue({ data: { revisions: [PENDING_REVISION] } });
    approvePost.mockResolvedValue({
      data: { article: ARTICLE, revision: PENDING_REVISION },
    });

    renderDialog();
    const dialog = await screen.findByRole("dialog");

    const user = userEvent.setup();
    await user.click(
      await within(dialog).findByRole("button", { name: "Approve" }),
    );

    await waitFor(() => {
      expect(approvePost).toHaveBeenCalledWith(
        "/api/knowledge-articles/KB-002/revisions/7/approve",
      );
    });
  });

  test("the author may reject their own proposal — only approval is self-restricted", async () => {
    mockUseSession.mockReturnValue({
      data: { user: { email: "ada@example.com" } },
    });
    revisionsGet.mockResolvedValue({ data: { revisions: [PENDING_REVISION] } });
    rejectPost.mockResolvedValue({ data: { revision: PENDING_REVISION } });

    renderDialog();
    const dialog = await screen.findByRole("dialog");

    const user = userEvent.setup();
    await user.click(
      await within(dialog).findByRole("button", { name: "Reject" }),
    );

    await waitFor(() => {
      expect(rejectPost).toHaveBeenCalledWith(
        "/api/knowledge-articles/KB-002/revisions/7/reject",
      );
    });
  });
});
