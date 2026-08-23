import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import {
  AUTO_REPLY_DECLINE,
  AUTO_REPLY_DECLINES,
  DASHBOARD_RANGE,
  type AssistantEffectivenessResponse,
  type AutoReplyDecline,
} from "@ticket/shared";
import { AssistantEffectivenessCard } from "./AssistantEffectivenessCard";

/**
 * Plain props, no query client — same reasoning as `MiniBarList.test.tsx`:
 * this component touches neither the router nor react-query.
 */

function zeroReasons(): Record<AutoReplyDecline, number> {
  return Object.fromEntries(AUTO_REPLY_DECLINES.map((d) => [d, 0])) as Record<
    AutoReplyDecline,
    number
  >;
}

function effectiveness(
  over: Partial<AssistantEffectivenessResponse> = {},
): AssistantEffectivenessResponse {
  return {
    range: DASHBOARD_RANGE.d30,
    from: "2026-07-23T00:00:00.000Z",
    to: "2026-08-22T00:00:00.000Z",
    classified: 40,
    autoReply: { resolved: 20, rate: 0.5 },
    decline: { count: 12, rate: 0.3, reasons: zeroReasons() },
    categoryOverride: { count: 4, rate: 0.1 },
    avgEditDistance: null,
    ...over,
  };
}

describe("AssistantEffectivenessCard", () => {
  test("renders the three rates and their counts", () => {
    render(<AssistantEffectivenessCard data={effectiveness()} />);
    expect(screen.getByText("Auto-replied")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("20 of 40")).toBeInTheDocument();

    expect(screen.getByText("Declined")).toBeInTheDocument();
    expect(screen.getByText("30%")).toBeInTheDocument();
    expect(screen.getByText("12 of 40")).toBeInTheDocument();

    expect(screen.getByText("Category overridden")).toBeInTheDocument();
    expect(screen.getByText("10%")).toBeInTheDocument();
    expect(screen.getByText("4 of 40")).toBeInTheDocument();
  });

  test("shows the classified count in the subtitle", () => {
    render(<AssistantEffectivenessCard data={effectiveness({ classified: 40 })} />);
    expect(
      screen.getByText("40 tickets classified in this range"),
    ).toBeInTheDocument();
  });

  test("shows the empty state when nothing was classified", () => {
    render(
      <AssistantEffectivenessCard
        data={effectiveness({
          classified: 0,
          autoReply: { resolved: 0, rate: null },
          decline: { count: 0, rate: null, reasons: zeroReasons() },
          categoryOverride: { count: 0, rate: null },
        })}
      />,
    );
    expect(
      screen.getByText("No tickets were classified in this range."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Auto-replied")).not.toBeInTheDocument();
  });

  test("shows only the decline reasons that fired, biggest first", () => {
    const reasons = zeroReasons();
    reasons[AUTO_REPLY_DECLINE.notCovered] = 7;
    reasons[AUTO_REPLY_DECLINE.noCitation] = 2;

    render(
      <AssistantEffectivenessCard
        data={effectiveness({ decline: { count: 9, rate: 0.2, reasons } })}
      />,
    );

    const list = screen.getByText("Decline reasons").closest("div") as HTMLElement;
    const items = list.querySelectorAll("li");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Not covered by the knowledge base");
    expect(items[0]).toHaveTextContent("7");
    expect(items[1]).toHaveTextContent("Cited nothing that resolves");
  });

  test("omits the decline reasons section when nothing declined", () => {
    render(
      <AssistantEffectivenessCard
        data={effectiveness({ decline: { count: 0, rate: 0, reasons: zeroReasons() } })}
      />,
    );
    expect(screen.queryByText("Decline reasons")).not.toBeInTheDocument();
  });

  test("notes that edit distance isn't tracked yet when the slice has no pairs", () => {
    render(<AssistantEffectivenessCard data={effectiveness({ avgEditDistance: null })} />);
    expect(
      screen.getByText("Draft-vs-sent edit distance isn't tracked yet."),
    ).toBeInTheDocument();
  });

  test("shows the rounded average once a number exists", () => {
    render(<AssistantEffectivenessCard data={effectiveness({ avgEditDistance: 12.5 })} />);
    expect(
      screen.queryByText("Draft-vs-sent edit distance isn't tracked yet."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Average draft-vs-sent edit distance: 13 characters"),
    ).toBeInTheDocument();
  });
});
