import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  DEMO_READ_ONLY_NOTE,
  USER_ROLE,
  type PipelineConfig,
} from "@ticket/shared";
import { renderRoutes } from "@/test/render";
import { PipelineSimulator } from "./PipelineSimulator";

vi.mock("@/lib/api", () => import("@/test/api-stub"));

const ADMIN = { name: "Ada Admin", role: USER_ROLE.admin };
const DEMO = { name: "Demo visitor", role: USER_ROLE.agent, isAnonymous: true };
const session = vi.hoisted(() => ({ user: {} as Record<string, unknown> }));

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: { user: session.user }, isPending: false }),
}));

/** Everything on, so the only thing that can shut the form is the viewer. */
const CONFIG: PipelineConfig = {
  aiConfigured: true,
  autoReplyEnabled: true,
  autoReplyArticleCount: 3,
  simulatorEnabled: true,
};

function renderSimulator() {
  return renderRoutes([
    {
      path: "/",
      element: <PipelineSimulator config={CONFIG} onSent={() => {}} />,
    },
  ]);
}

beforeEach(() => {
  session.user = ADMIN;
});

afterEach(() => {
  vi.clearAllMocks();
});

// #326: the plan's Deferred section keeps the simulator shut to a demo — its
// AI spend runs in background jobs outside the demo budget, and it feeds a
// stranger's text into ingestion. `requireAdmin` refuses it; this says so.
describe("PipelineSimulator", () => {
  test("is shut to a demo session on a deployment where it is on, with the note", () => {
    session.user = DEMO;
    renderSimulator();

    expect(
      screen.getByRole("button", { name: "Send as customer" }),
    ).toBeDisabled();
    expect(screen.getByLabelText("Subject")).toBeDisabled();
    expect(screen.getByText(DEMO_READ_ONLY_NOTE)).toBeInTheDocument();
    // The env-var instruction is for an owner, not for a visitor.
    expect(
      screen.queryByText(/PIPELINE_SIMULATOR_ENABLED/),
    ).not.toBeInTheDocument();
  });

  test("is open to an admin where it is on", () => {
    renderSimulator();

    expect(
      screen.getByRole("button", { name: "Send as customer" }),
    ).toBeEnabled();
    expect(screen.getByLabelText("Subject")).toBeEnabled();
    expect(screen.queryByText(DEMO_READ_ONLY_NOTE)).not.toBeInTheDocument();
  });
});
