import { DASHBOARD_BUCKET } from "@ticket/shared";
import { formatBucketFull, formatBucketLabel, formatDateRange } from "./format";

// Dates are British order, and a range joins its ends with an unspaced en dash,
// each shared part written once (docs/standards/copy.md, "Spelling and
// mechanics").

describe("formatBucketLabel", () => {
  test("puts the day before the month", () => {
    expect(formatBucketLabel("2026-08-03", DASHBOARD_BUCKET.day)).toBe("3 Aug");
    expect(formatBucketLabel("2026-08-03", DASHBOARD_BUCKET.week)).toBe(
      "3 Aug",
    );
  });

  test("names a month bucket by month and short year", () => {
    expect(formatBucketLabel("2026-08-01", DASHBOARD_BUCKET.month)).toBe(
      "Aug 26",
    );
  });
});

describe("formatBucketFull", () => {
  test("spells a day out in British order", () => {
    expect(formatBucketFull("2026-08-03", DASHBOARD_BUCKET.day)).toBe(
      "3 Aug 2026",
    );
  });

  test("prefixes a week with its start", () => {
    expect(formatBucketFull("2026-08-03", DASHBOARD_BUCKET.week)).toBe(
      "Week of 3 Aug 2026",
    );
  });

  test("names a month bucket by month and year", () => {
    expect(formatBucketFull("2026-08-01", DASHBOARD_BUCKET.month)).toBe(
      "Aug 2026",
    );
  });
});

describe("formatDateRange", () => {
  const day = (y: number, m: number, d: number) => new Date(y, m - 1, d);

  test("a single date reads day, month, year", () => {
    expect(formatDateRange(day(2026, 10, 9))).toBe("9 Oct 2026");
  });

  test("a range ending the day it starts collapses to one date", () => {
    expect(formatDateRange(day(2026, 10, 9), day(2026, 10, 9))).toBe(
      "9 Oct 2026",
    );
  });

  test("within a month, writes the month and year once", () => {
    expect(formatDateRange(day(2026, 10, 9), day(2026, 10, 12))).toBe(
      "9–12 Oct 2026",
    );
  });

  test("across months, writes the year once", () => {
    expect(formatDateRange(day(2026, 9, 30), day(2026, 10, 2))).toBe(
      "30 Sep–2 Oct 2026",
    );
  });

  test("across years, writes both ends in full", () => {
    expect(formatDateRange(day(2025, 12, 30), day(2026, 1, 2))).toBe(
      "30 Dec 2025–2 Jan 2026",
    );
  });
});
