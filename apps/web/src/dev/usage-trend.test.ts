import { describe, expect, it } from "vitest";
import type { TrendPoint } from "./usage-protocol";
import { formatEdges, tokenTick, trendSeries } from "./usage-trend";

const point = (over: Partial<TrendPoint> = {}): TrendPoint => ({
  day: "2026-10-04",
  at: "2026-10-04T10:00:00.000Z",
  measured: 3,
  p25: 3000,
  median: 20_000,
  p75: 90_000,
  scored: 2,
  onTarget: 1,
  edges: { S: 60_000, M: 150_000, L: 250_000 },
  ...over,
});

describe("trendSeries", () => {
  it("puts each day's figures and its own edges on one datum", () => {
    expect(trendSeries([point()])).toEqual([
      {
        day: "2026-10-04",
        p25: 3000,
        median: 20_000,
        p75: 90_000,
        accuracy: 50,
        edgeS: 60_000,
        edgeM: 150_000,
        edgeL: 250_000,
      },
    ]);
  });

  it("leaves a gap, not a zero, for a day that measured or scored nothing", () => {
    const [datum] = trendSeries([
      point({ measured: 0, p25: 0, median: 0, p75: 0, scored: 0, onTarget: 0 }),
    ]);

    expect(datum).toMatchObject({
      p25: null,
      median: null,
      p75: null,
      accuracy: null,
    });
  });

  it("keeps an earlier day's edges when the bands have since moved (R7)", () => {
    const series = trendSeries([
      point({
        day: "2026-10-03",
        edges: { S: 50_000, M: 120_000, L: 200_000 },
      }),
      point(),
    ]);

    expect(series.map((d) => d.edgeS)).toEqual([50_000, 60_000]);
  });
});

describe("formatEdges", () => {
  it("prints the closed bands' edges, S to L", () => {
    expect(formatEdges(point().edges)).toBe(
      "S <60,000 · M <150,000 · L <250,000",
    );
  });
});

describe("tokenTick", () => {
  it("prints thousands", () => {
    expect(tokenTick(150_000)).toBe("150k");
    expect(tokenTick(0)).toBe("0");
  });
});
