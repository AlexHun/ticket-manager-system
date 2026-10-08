import { describe, expect, it } from "vitest";
import {
  LIFECYCLE_EDGES,
  LIFECYCLE_STEP,
  LIFECYCLE_STEPS,
  edgesInto,
  stepBeside,
} from "./lifecycle";

const first = LIFECYCLE_STEPS[0]!.id;
const last = LIFECYCLE_STEPS.at(-1)!.id;

describe("stepBeside", () => {
  it("walks the steps in the data's order", () => {
    let current = stepBeside(null, 1);
    const walked = [current];
    while (current !== null) {
      current = stepBeside(current, 1);
      if (current) walked.push(current);
    }
    expect(walked).toEqual(LIFECYCLE_STEPS.map((step) => step.id));
  });

  it("goes back one step", () => {
    expect(stepBeside(LIFECYCLE_STEPS[3]!.id, -1)).toBe(LIFECYCLE_STEPS[2]!.id);
  });

  it("starts at the first step, and goes nowhere back from nothing", () => {
    expect(stepBeside(null, 1)).toBe(first);
    expect(stepBeside(null, -1)).toBeNull();
  });

  it("stops at either end", () => {
    expect(stepBeside(first, -1)).toBeNull();
    expect(stepBeside(last, 1)).toBeNull();
  });
});

describe("edgesInto", () => {
  it("is every edge that ends at the step", () => {
    expect(edgesInto(LIFECYCLE_STEP.customerReplies).map((e) => e.id)).toEqual(
      LIFECYCLE_EDGES.filter(
        (e) => e.to === LIFECYCLE_STEP.customerReplies,
      ).map((e) => e.id),
    );
    expect(edgesInto(LIFECYCLE_STEP.customerReplies)).toHaveLength(2);
  });

  it("is empty for the step that starts it all", () => {
    expect(edgesInto(first)).toEqual([]);
  });
});
