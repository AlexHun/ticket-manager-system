import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  DEMO_READ_ONLY_NOTE,
  TICKET_CATEGORY,
  USER_ROLE,
  type KnowledgeArticle,
} from "@ticket/shared";
import { apiStub } from "@/test/api-stub";
import { renderRoutes } from "@/test/render";
import { KnowledgePage } from "./KnowledgePage";

vi.mock("@/lib/api", () => import("@/test/api-stub"));

const ADMIN = { name: "Ada Admin", role: USER_ROLE.admin };
const DEMO = { name: "Demo visitor", role: USER_ROLE.agent, isAnonymous: true };
const session = vi.hoisted(() => ({ user: {} as Record<string, unknown> }));

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: { user: session.user }, isPending: false }),
}));

const articlesGet = apiStub.get("/api/knowledge-articles");
const pendingGet = apiStub.get("/api/knowledge-articles/pending-revisions");

const LIVE: KnowledgeArticle = {
  id: "KB-001",
  title: "How do I reset my password?",
  category: TICKET_CATEGORY.Technical,
  body: "Use the 'forgot password' link on the sign-in page.",
  internalNote: null,
  autoReply: true,
  archived: false,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

function renderKnowledgePage() {
  return renderRoutes([{ path: "/knowledge", Component: KnowledgePage }], {
    initialEntries: ["/knowledge"],
  });
}

beforeEach(() => {
  apiStub.reset();
  session.user = ADMIN;
  articlesGet.mockResolvedValue({ data: { articles: [LIVE] } });
  pendingGet.mockResolvedValue({ data: { revisions: [] } });
});

afterEach(() => {
  vi.clearAllMocks();
});

// #326, R5: every article is there to read, and nothing on the page changes
// one. `requireAdmin` on each write is the control; this is what a visitor
// meets before reaching it.
describe("KnowledgePage — a demo session", () => {
  beforeEach(() => {
    session.user = DEMO;
  });

  test("says the page is read-only, and disables New article and Archive", async () => {
    renderKnowledgePage();
    await screen.findByText(LIVE.title);

    expect(screen.getByText(DEMO_READ_ONLY_NOTE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New article" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Archive" })).toBeDisabled();
    // History is a read, and stays open to them.
    expect(screen.getByRole("button", { name: "History" })).toBeEnabled();
  });

  test("opens an article to read, with its fields and Save changes disabled", async () => {
    renderKnowledgePage();
    await screen.findByText(LIVE.title);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Edit" }));

    const dialog = await screen.findByRole("dialog", {
      name: `Edit ${LIVE.id}`,
    });
    expect(within(dialog).getByLabelText("Question")).toHaveValue(LIVE.title);
    expect(within(dialog).getByLabelText("Question")).toBeDisabled();
    expect(
      within(dialog).getByLabelText("Let the assistant answer from this"),
    ).toBeDisabled();
    expect(
      within(dialog).getByRole("button", { name: "Save changes" }),
    ).toBeDisabled();
    expect(within(dialog).getByText(DEMO_READ_ONLY_NOTE)).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Cancel" }),
    ).toBeEnabled();
  });
});

describe("KnowledgePage — an admin", () => {
  test("has every control live and no read-only note", async () => {
    renderKnowledgePage();
    await screen.findByText(LIVE.title);

    expect(screen.queryByText(DEMO_READ_ONLY_NOTE)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New article" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Archive" })).toBeEnabled();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog", {
      name: `Edit ${LIVE.id}`,
    });
    expect(
      within(dialog).getByRole("button", { name: "Save changes" }),
    ).toBeEnabled();
  });
});
