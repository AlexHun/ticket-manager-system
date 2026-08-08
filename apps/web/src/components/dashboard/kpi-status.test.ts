import { describe, expect, test } from "vitest";
import {
  LATENCY_BUCKET,
  TICKET_STATUS,
  type FirstResponseStats,
  type TicketStatsSummary,
} from "@ticket/shared";
import {
  KPI_THRESHOLD,
  firstReplyVerdict,
  openVerdict,
  settledVerdict,
} from "./kpi-status";
import { KPI_STATUS } from "./StatusPill";

// --- Helpers --------------------------------------------------------------

/**
 * A summary with everything unremarkable, so each test states only the field it
 * is about. `total: 100` makes the share thresholds readable as percentages.
 */
function summary(over: Partial<TicketStatsSummary> = {}): TicketStatsSummary {
  return {
    total: 100,
    previousTotal: 100,
    byStatus: {
      [TICKET_STATUS.Open]: 10,
      [TICKET_STATUS.Resolved]: 60,
      [TICKET_STATUS.Closed]: 30,
    },
    openUnassigned: 0,
    settledShare: 0.9,
    ...over,
  };
}

function firstResponse(
  over: Partial<FirstResponseStats> = {},
): FirstResponseStats {
  return {
    responded: 100,
    awaiting: 0,
    medianHours: 1,
    p90Hours: 3,
    buckets: {
      [LATENCY_BUCKET.under1h]: 50,
      [LATENCY_BUCKET.h1to4]: 30,
      [LATENCY_BUCKET.h4to24]: 15,
      [LATENCY_BUCKET.over24h]: 5,
    },
    ...over,
  };
}

// --- Open backlog ---------------------------------------------------------

describe("openVerdict", () => {
  test("is silent when the queue is healthy", () => {
    expect(openVerdict(summary())).toBeNull();
  });

  test("is silent when nothing is open, even with no tickets at all", () => {
    expect(
      openVerdict(
        summary({
          total: 0,
          byStatus: {
            [TICKET_STATUS.Open]: 0,
            [TICKET_STATUS.Resolved]: 0,
            [TICKET_STATUS.Closed]: 0,
          },
        }),
      ),
    ).toBeNull();
  });

  test("warns on open share at the threshold", () => {
    const open = KPI_THRESHOLD.warnOpenShare * 100;
    expect(
      openVerdict(
        summary({
          byStatus: {
            [TICKET_STATUS.Open]: open,
            [TICKET_STATUS.Resolved]: 100 - open,
            [TICKET_STATUS.Closed]: 0,
          },
        }),
      ),
    ).toEqual({ status: KPI_STATUS.warning, label: "Needs triage" });
  });

  test("escalates to critical at the higher share", () => {
    const open = KPI_THRESHOLD.criticalOpenShare * 100;
    expect(
      openVerdict(
        summary({
          byStatus: {
            [TICKET_STATUS.Open]: open,
            [TICKET_STATUS.Resolved]: 100 - open,
            [TICKET_STATUS.Closed]: 0,
          },
        }),
      )?.status,
    ).toBe(KPI_STATUS.critical);
  });

  /**
   * The share is what decides, not the count — this is the case a fixed
   * "more than N open" rule would get wrong in both directions.
   */
  test("judges by share, so the same count reads differently in a bigger slice", () => {
    const byStatus = {
      [TICKET_STATUS.Open]: 25,
      [TICKET_STATUS.Resolved]: 5,
      [TICKET_STATUS.Closed]: 0,
    };
    expect(openVerdict(summary({ total: 30, byStatus }))?.status).toBe(
      KPI_STATUS.critical,
    );
    expect(openVerdict(summary({ total: 500, byStatus }))).toBeNull();
  });

  test("a single unassigned ticket warns even when the share is fine", () => {
    expect(openVerdict(summary({ openUnassigned: 1 }))).toEqual({
      status: KPI_STATUS.warning,
      label: "Needs triage",
    });
  });

  test("enough unassigned tickets are critical on their own", () => {
    expect(
      openVerdict(
        summary({ openUnassigned: KPI_THRESHOLD.criticalUnassigned }),
      )?.status,
    ).toBe(KPI_STATUS.critical);
  });
});

// --- Settled --------------------------------------------------------------

describe("settledVerdict", () => {
  test("congratulates at the threshold", () => {
    expect(
      settledVerdict(summary({ settledShare: KPI_THRESHOLD.goodSettledShare })),
    ).toEqual({ status: KPI_STATUS.good, label: "On track" });
  });

  test("is silent below it rather than warning", () => {
    expect(
      settledVerdict(
        summary({ settledShare: KPI_THRESHOLD.goodSettledShare - 0.01 }),
      ),
    ).toBeNull();
  });

  /** An empty slice is not an achievement. */
  test("is silent on an empty slice despite settledShare being vacuously high", () => {
    expect(settledVerdict(summary({ total: 0, settledShare: 1 }))).toBeNull();
  });
});

// --- First reply ----------------------------------------------------------

describe("firstReplyVerdict", () => {
  test("calls a fast median good", () => {
    expect(firstReplyVerdict(firstResponse({ medianHours: 0.5 }))).toEqual({
      status: KPI_STATUS.good,
      label: "Fast",
    });
  });

  test("warns as the median crosses the first threshold", () => {
    expect(
      firstReplyVerdict(
        firstResponse({ medianHours: KPI_THRESHOLD.warnFirstReplyHours }),
      ),
    ).toEqual({ status: KPI_STATUS.warning, label: "Slowing" });
  });

  test("is critical at the second", () => {
    expect(
      firstReplyVerdict(
        firstResponse({ medianHours: KPI_THRESHOLD.criticalFirstReplyHours }),
      ),
    ).toEqual({ status: KPI_STATUS.critical, label: "Slipping" });
  });

  /**
   * The whole reason `awaiting` is checked first: a median computed only over
   * answered tickets can look excellent while people are still waiting.
   */
  test("unanswered tickets outrank a healthy median", () => {
    expect(
      firstReplyVerdict(firstResponse({ medianHours: 0.1, awaiting: 1 })),
    ).toEqual({ status: KPI_STATUS.warning, label: "Unanswered" });
  });

  test("enough unanswered tickets are critical", () => {
    expect(
      firstReplyVerdict(
        firstResponse({
          medianHours: 0.1,
          awaiting: KPI_THRESHOLD.criticalUnassigned,
        }),
      )?.status,
    ).toBe(KPI_STATUS.critical);
  });

  test("says nothing when nothing was ever replied to", () => {
    expect(
      firstReplyVerdict(
        firstResponse({ medianHours: null, responded: 0, awaiting: 0 }),
      ),
    ).toBeNull();
  });
});
