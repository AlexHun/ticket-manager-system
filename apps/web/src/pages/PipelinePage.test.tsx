import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  AUTO_REPLY_DECLINE,
  AUTO_REPLY_DECLINES,
  HANDOFF_TARGET,
  PIPELINE_OUTCOME,
  TICKET_STATUS,
  USER_ROLE,
  type AutoReplyDecline,
  type AutomationSettings,
  type PipelineOverviewResponse,
  type PipelineRun,
} from "@ticket/shared";
import { apiStub } from "@/test/api-stub";
import { renderRoutes } from "@/test/render";
import { PipelinePage } from "./PipelinePage";

vi.mock("@/lib/api", () => import("@/test/api-stub"));

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({
    data: { user: { name: "Ada Admin", role: USER_ROLE.admin } },
    isPending: false,
  }),
}));

const overviewGet = apiStub.get("/api/pipeline");
const runGet = apiStub.get("/api/pipeline/runs/:id");
const simulatePost = apiStub.post("/api/pipeline/simulate");
const settingsGet = apiStub.get("/api/automation");
const assigneesGet = apiStub.get("/api/tickets/assignees");

/** A ticket whose draft the checks threw away, as both routes report it. */
const DECLINED: PipelineRun = {
  ticketId: 553,
  subject: "Password reset link keeps expiring",
  customerName: "Sofia Eriksson",
  status: TICKET_STATUS.Open,
  category: null,
  createdAt: "2026-11-02T09:00:00.000Z",
  outcome: PIPELINE_OUTCOME.declined,
  decline: AUTO_REPLY_DECLINE.unbackedCommitment,
  declinedAt: "2026-11-02T09:00:16.000Z",
  citedArticleIds: [],
  stages: [],
  judgement: null,
};

/** A sent ticket the auto-reply has not answered yet. */
const PENDING: PipelineRun = {
  ...DECLINED,
  ticketId: 600,
  status: TICKET_STATUS.New,
  outcome: PIPELINE_OUTCOME.pending,
  decline: null,
  declinedAt: null,
};

const IDLE = { ready: 0, active: 0, deferred: 0 };

const OVERVIEW: PipelineOverviewResponse = {
  config: {
    aiConfigured: true,
    autoReplyEnabled: true,
    autoReplyArticleCount: 3,
    simulatorEnabled: true,
  },
  range: "90d",
  from: "2026-08-04T00:00:00.000Z",
  to: "2026-11-02T00:00:00.000Z",
  counts: {
    received: 1,
    machineClassified: 1,
    classifyAbandoned: 0,
    classifyPending: 0,
    classifyNotOffered: { noKey: 0, filedOrStale: 0 },
    autoResolved: 0,
    declines: Object.fromEntries(
      AUTO_REPLY_DECLINES.map((decline) => [decline, 0]),
    ) as Record<AutoReplyDecline, number>,
  },
  queues: { classify: IDLE, autoReply: IDLE },
  recent: [DECLINED],
};

const SETTINGS: AutomationSettings = {
  target: HANDOFF_TARGET.admin,
  user: null,
  resolvedTo: { id: "admin-1", name: "Ada Admin", email: "ada@example.com" },
  assistant: {
    id: "assistant-1",
    name: "Support Assistant",
    email: "assistant@example.com",
  },
  updatedAt: null,
  updatedByName: null,
};

function renderPage() {
  return renderRoutes([{ path: "/", element: <PipelinePage /> }]);
}

beforeEach(() => {
  apiStub.reset();
  overviewGet.mockResolvedValue({ data: OVERVIEW });
  runGet.mockResolvedValue({ data: { run: DECLINED } });
  settingsGet.mockResolvedValue({ data: { settings: SETTINGS } });
  assigneesGet.mockResolvedValue({ data: { assignees: [] } });
});

afterEach(() => {
  vi.clearAllMocks();
});

// #726: a pick refetched the overview and the run again, though a listed run
// has already landed and moved nothing.
describe("PipelinePage", () => {
  test("picking a recent arrival draws its trace without refetching the totals", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole("button", {
        name: /Password reset link keeps expiring/,
      }),
    );

    expect(
      await screen.findByRole("heading", { name: "Ticket #553" }),
    ).toBeInTheDocument();
    // Let any refetch the commit's effects started reach the stub.
    await act(async () => {});
    expect(runGet).toHaveBeenCalledTimes(1);
    expect(overviewGet).toHaveBeenCalledTimes(1);
  });

  test("picking a recent arrival while a sent ticket is pending stops watching it", async () => {
    const user = userEvent.setup();
    simulatePost.mockResolvedValue({
      data: { ticketId: 600, threaded: false, messageId: "<sim@example>" },
    });
    runGet.mockImplementation((url: string) =>
      Promise.resolve({
        data: {
          run: url.endsWith(`/${PENDING.ticketId}`) ? PENDING : DECLINED,
        },
      }),
    );
    renderPage();

    await user.click(
      await screen.findByRole("button", { name: "Send as customer" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Ticket #600" }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: /Password reset link keeps expiring/,
      }),
    );
    expect(
      await screen.findByRole("heading", { name: "Ticket #553" }),
    ).toBeInTheDocument();
    await act(async () => {});
    expect(overviewGet).toHaveBeenCalledTimes(1);
  });

  test("a sent ticket's verdict landing refetches the totals it moved", async () => {
    const user = userEvent.setup();
    simulatePost.mockResolvedValue({
      data: { ticketId: 553, threaded: false, messageId: "<sim@example>" },
    });
    renderPage();

    await user.click(
      await screen.findByRole("button", { name: "Send as customer" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Ticket #553" }),
    ).toBeInTheDocument();
    await act(async () => {});
    expect(overviewGet).toHaveBeenCalledTimes(2);
  });
});
