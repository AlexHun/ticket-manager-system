import { describe, expect, it } from "vitest";
import {
  LIFECYCLE_STEP,
  LIFECYCLE_STEPS,
  edgesFrom,
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
  it("is every edge that ends at the step, both at a join", () => {
    expect(edgesInto(LIFECYCLE_STEP.customerReplies)).toEqual([
      {
        id: "autoReplySent-customerReplies",
        from: LIFECYCLE_STEP.autoReplySent,
        to: LIFECYCLE_STEP.customerReplies,
      },
      {
        id: "agentResolves-customerReplies",
        from: LIFECYCLE_STEP.agentResolves,
        to: LIFECYCLE_STEP.customerReplies,
      },
    ]);
  });

  it("is empty for the step that starts it all", () => {
    expect(edgesInto(first)).toEqual([]);
  });
});

describe("edgesFrom", () => {
  it("is both arms at a fork", () => {
    expect(edgesFrom(LIFECYCLE_STEP.claim).map((e) => e.to)).toEqual([
      LIFECYCLE_STEP.autoReplySent,
      LIFECYCLE_STEP.declineHandoff,
    ]);
  });

  it("is empty for the step that ends it", () => {
    expect(edgesFrom(last)).toEqual([]);
  });
});
