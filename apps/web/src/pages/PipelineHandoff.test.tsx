import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  DEMO_READ_ONLY_NOTE,
  HANDOFF_TARGET,
  USER_ROLE,
  type AutomationSettings,
} from "@ticket/shared";
import { apiStub } from "@/test/api-stub";
import { renderRoutes } from "@/test/render";
import { PipelineHandoff } from "./PipelineHandoff";

vi.mock("@/lib/api", () => import("@/test/api-stub"));

const ADMIN = { name: "Ada Admin", role: USER_ROLE.admin };
const DEMO = { name: "Demo visitor", role: USER_ROLE.agent, isAnonymous: true };
const session = vi.hoisted(() => ({ user: {} as Record<string, unknown> }));

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: { user: session.user }, isPending: false }),
}));

const settingsGet = apiStub.get("/api/automation");
const assigneesGet = apiStub.get("/api/tickets/assignees");

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

function renderHandoff() {
  return renderRoutes([{ path: "/", element: <PipelineHandoff /> }]);
}

beforeEach(() => {
  apiStub.reset();
  session.user = ADMIN;
  settingsGet.mockResolvedValue({ data: { settings: SETTINGS } });
  assigneesGet.mockResolvedValue({ data: { assignees: [] } });
});

afterEach(() => {
  vi.clearAllMocks();
});

// #326, R5: the handoff is automation a demo session may see and not change.
describe("PipelineHandoff", () => {
  test("a demo session sees the setting with the picker disabled and the note", async () => {
    session.user = DEMO;
    renderHandoff();

    const picker = await screen.findByRole("combobox", {
      name: "Handed back to a person",
    });
    expect(picker).toBeDisabled();
    expect(screen.getByText("Right now that's Ada Admin.")).toBeInTheDocument();
    expect(screen.getByText(DEMO_READ_ONLY_NOTE)).toBeInTheDocument();
  });

  test("an admin's picker is live, with no read-only note", async () => {
    renderHandoff();

    const picker = await screen.findByRole("combobox", {
      name: "Handed back to a person",
    });
    expect(picker).toBeEnabled();
    expect(screen.queryByText(DEMO_READ_ONLY_NOTE)).not.toBeInTheDocument();
  });
});

// #485: the card names the Backlog, the Team and an assignee as the glossary does.
describe("PipelineHandoff copy", () => {
  test("says every ticket leaving the rail gets an assignee", async () => {
    renderHandoff();

    expect(
      await screen.findByText(/Every ticket leaving the rail gets an assignee/),
    ).toBeInTheDocument();
  });

  test("offers leaving a handed-back ticket in the backlog", async () => {
    const user = userEvent.setup();
    renderHandoff();

    await user.click(
      await screen.findByRole("combobox", { name: "Handed back to a person" }),
    );

    expect(
      screen.getByRole("option", { name: "Nobody — leave it in the backlog" }),
    ).toBeInTheDocument();
  });

  test("an unassigned target says the tickets go back to the backlog", async () => {
    settingsGet.mockResolvedValue({
      data: {
        settings: {
          ...SETTINGS,
          target: HANDOFF_TARGET.unassigned,
          resolvedTo: null,
        },
      },
    });
    renderHandoff();

    expect(
      await screen.findByText(
        "Right now nobody — these tickets go back to the backlog unassigned.",
      ),
    ).toBeInTheDocument();
  });

  test("a person who has left is no longer on the Team", async () => {
    settingsGet.mockResolvedValue({
      data: {
        settings: {
          ...SETTINGS,
          target: HANDOFF_TARGET.user,
          user: { id: "gone-1", name: "Gone Agent", email: "gone@example.com" },
        },
      },
    });
    renderHandoff();

    expect(
      await screen.findByText(
        /The person you picked is no longer on the Team\./,
      ),
    ).toBeInTheDocument();
  });

  test("a failed load says what failed and what to do", async () => {
    settingsGet.mockRejectedValue({});
    renderHandoff();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't load the handoff settings. Try again.",
    );
  });
});
