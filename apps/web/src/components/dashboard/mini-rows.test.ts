import { describe, expect, test } from "vitest";
import {
  AGE_BUCKET,
  TICKET_CATEGORY,
  TICKET_STATUS,
  type AgentWorkload,
  type BacklogAgeStats,
  type WorkloadCounts,
} from "@ticket/shared";
import { backlogAgeRows, categoryRows, workloadRows } from "./mini-rows";
import { AGE_LABEL, ORDINAL_FILL, UNCATEGORISED_LABEL } from "./chart-tokens";

// --- Helpers --------------------------------------------------------------

function counts(over: Partial<WorkloadCounts> = {}): WorkloadCounts {
  return {
    total: 0,
    [TICKET_STATUS.New]: 0,
    [TICKET_STATUS.Processing]: 0,
    [TICKET_STATUS.Open]: 0,
    [TICKET_STATUS.Resolved]: 0,
    [TICKET_STATUS.Closed]: 0,
    ...over,
  };
}

function agent(
  id: string,
  name: string,
  over: Partial<WorkloadCounts> = {},
): AgentWorkload {
  return { id, name, ...counts(over) };
}

function backlog(
  buckets: Partial<BacklogAgeStats["buckets"]> = {},
): BacklogAgeStats {
  return {
    open: 0,
    medianAgeHours: null,
    buckets: {
      [AGE_BUCKET.under1d]: 0,
      [AGE_BUCKET.d1to3]: 0,
      [AGE_BUCKET.d3to7]: 0,
      [AGE_BUCKET.over7d]: 0,
      ...buckets,
    },
  };
}

const labels = (rows: { label: string }[]) => rows.map((r) => r.label);

// --- Categories -----------------------------------------------------------

describe("categoryRows", () => {
  test("sorts named categories by size, largest first", () => {
    const rows = categoryRows([
      { category: TICKET_CATEGORY.General, count: 3 },
      { category: TICKET_CATEGORY.Technical, count: 9 },
      { category: TICKET_CATEGORY.Refund, count: 5 },
    ]);
    expect(labels(rows)).toEqual([
      TICKET_CATEGORY.Technical,
      TICKET_CATEGORY.Refund,
      TICKET_CATEGORY.General,
    ]);
  });

  /**
   * The pin is the point: "not filed yet" is a different kind of thing from the
   * real categories, so sorting it into the middle of them would imply it is one.
   */
  test("pins uncategorised last even when it is the biggest", () => {
    const rows = categoryRows([
      { category: null, count: 99 },
      { category: TICKET_CATEGORY.Technical, count: 2 },
    ]);
    expect(labels(rows)).toEqual([TICKET_CATEGORY.Technical, UNCATEGORISED_LABEL]);
  });

  test("omits the uncategorised row entirely when the API sends no null bucket", () => {
    const rows = categoryRows([{ category: TICKET_CATEGORY.Other, count: 1 }]);
    expect(labels(rows)).toEqual([TICKET_CATEGORY.Other]);
  });

  test("keeps a zero-count uncategorised row, which is a real state", () => {
    const rows = categoryRows([{ category: null, count: 0 }]);
    expect(rows).toEqual([{ label: UNCATEGORISED_LABEL, value: 0 }]);
  });
});

// --- Workload -------------------------------------------------------------

describe("workloadRows", () => {
  /**
   * An idle agent is information. Filtering them out would quietly change the
   * question from "who has tickets" to "who has any".
   */
  test("keeps agents with nothing in the slice", () => {
    const rows = workloadRows(
      [agent("a1", "Busy", { total: 4 }), agent("a2", "Idle")],
      counts(),
    );
    expect(labels(rows)).toEqual(["Busy", "Idle"]);
    expect(rows[1].value).toBe(0);
  });

  test("appends the unassigned pile last when it has anything in it", () => {
    const rows = workloadRows(
      [agent("a1", "Ann", { total: 1 })],
      counts({ total: 7 }),
    );
    expect(labels(rows)).toEqual(["Ann", "Unassigned"]);
  });

  test("omits the unassigned row when nothing is unowned", () => {
    const rows = workloadRows([agent("a1", "Ann", { total: 1 })], counts());
    expect(labels(rows)).toEqual(["Ann"]);
  });

  test("notes how many of a row are still open", () => {
    const rows = workloadRows(
      [agent("a1", "Ann", { total: 5, [TICKET_STATUS.Open]: 2 })],
      counts(),
    );
    expect(rows[0].note).toBe("2 open");
  });

  test("leaves the note off when a row has nothing open", () => {
    const rows = workloadRows(
      [agent("a1", "Ann", { total: 5, [TICKET_STATUS.Resolved]: 5 })],
      counts(),
    );
    expect(rows[0].note).toBeUndefined();
  });
});

// --- Backlog age ----------------------------------------------------------

describe("backlogAgeRows", () => {
  /**
   * These buckets are ordinal — the ramp encodes their order — so the row order
   * is fixed and must never be sorted by size.
   */
  test("keeps buckets in age order regardless of their counts", () => {
    const rows = backlogAgeRows(
      backlog({
        [AGE_BUCKET.under1d]: 1,
        [AGE_BUCKET.d1to3]: 90,
        [AGE_BUCKET.d3to7]: 2,
        [AGE_BUCKET.over7d]: 40,
      }),
    );
    expect(labels(rows)).toEqual([
      AGE_LABEL[AGE_BUCKET.under1d],
      AGE_LABEL[AGE_BUCKET.d1to3],
      AGE_LABEL[AGE_BUCKET.d3to7],
      AGE_LABEL[AGE_BUCKET.over7d],
    ]);
  });

  test("assigns the ordinal ramp by position, so colour tracks age not size", () => {
    const rows = backlogAgeRows(backlog({ [AGE_BUCKET.under1d]: 100 }));
    expect(rows.map((r) => r.fill)).toEqual([...ORDINAL_FILL]);
  });

  test("emits every bucket even when all are empty", () => {
    const rows = backlogAgeRows(backlog());
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.value === 0)).toBe(true);
  });
});
