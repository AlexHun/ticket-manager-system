import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  DEMO_AI_LIMIT_MESSAGE,
  DEMO_AI_LIMIT_REASON,
  SUMMARY_SENTIMENT,
  type SummarizeTicketResponse,
} from "@ticket/shared";
import { toast } from "@/components/ui/sonner";
import { apiStub } from "@/test/api-stub";
import { renderRoutes } from "@/test/render";
import { TicketSummaryPanel } from "./TicketSummaryPanel";

/**
 * What the summary panel shows in place of a summary (#321): the summary
 * itself, an error, or — for a demo session once every demo session together
 * has spent the day's AI budget — the limit, as a fact about the demo rather
 * than as an error. The server made no call; pressing Summarise again will not
 * help until 00:00 UTC.
 */

vi.mock("@/lib/api", () => import("@/test/api-stub"));

const summarizePost = apiStub.post("/api/ai/summarize-ticket");

const RESULT: SummarizeTicketResponse = {
  summary: {
    overview: "A parcel from order TR-99182 has not arrived.",
    keyPoints: [],
    nextStep: null,
    sentiment: SUMMARY_SENTIMENT.neutral,
    highlights: [],
  },
  messageCount: 1,
};

/** Axios shape, so the panel reads the server's body. */
function axiosError(status: number, data: Record<string, string>) {
  return Object.assign(new Error("Request failed"), {
    isAxiosError: true,
    response: { status, data },
  });
}

function renderPanel() {
  renderRoutes([
    {
      path: "/",
      element: <TicketSummaryPanel ticketId={12} messageCount={1} />,
    },
  ]);
  return userEvent.setup();
}

function summariseButton(): HTMLElement {
  return screen.getByRole("button", { name: "Summarise" });
}

beforeEach(() => {
  apiStub.reset();
  // Nothing clears the global sonner mock between tests.
  vi.mocked(toast.error).mockClear();
});

describe("TicketSummaryPanel", () => {
  test("shows the summary it was sent", async () => {
    summarizePost.mockResolvedValue({ data: RESULT });
    const user = renderPanel();

    await user.click(summariseButton());

    expect(
      await screen.findByText(RESULT.summary.overview),
    ).toBeInTheDocument();
  });

  test("shows the demo AI limit as a note, not an error", async () => {
    summarizePost.mockRejectedValue(
      axiosError(429, {
        error: DEMO_AI_LIMIT_MESSAGE,
        reason: DEMO_AI_LIMIT_REASON,
      }),
    );
    const user = renderPanel();

    await user.click(summariseButton());

    expect(await screen.findByRole("status")).toHaveTextContent(
      DEMO_AI_LIMIT_MESSAGE,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
    // In place of the idle line, not beside it.
    expect(screen.queryByText(/Generate a fresh read/)).toBeNull();
  });

  test("leaves any other failure an error", async () => {
    summarizePost.mockRejectedValue(
      axiosError(429, {
        error:
          "You've asked for a lot of summaries just now — try again in a minute.",
      }),
    );
    const user = renderPanel();

    await user.click(summariseButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "try again in a minute",
    );
    expect(toast.error).toHaveBeenCalled();
    expect(screen.queryByText(DEMO_AI_LIMIT_MESSAGE)).toBeNull();
  });
});
