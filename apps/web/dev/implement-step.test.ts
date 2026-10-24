import { describe, expect, it } from "vitest";
import { implementStepOfCalls, type ToolCall } from "./implement-step.ts";
import { IMPLEMENT_STEP } from "../src/dev/sessions-protocol.ts";

/**
 * Slice 6 of `docs/plans/dev-tools-sessions-page.md` (#595, R9): which step of
 * `.claude/skills/implement/SKILL.md` a worker has reached, read off made-up
 * tool calls. Each case is the calls that skill's steps make, so an edit to
 * the skill that changes them breaks a case here before it misleads the page.
 */

const shell = (command: string): ToolCall => ({
  name: "PowerShell",
  input: { command },
});
const skill = (name: string): ToolCall => ({
  name: "Skill",
  input: { skill: name },
});
const tool = (name: string): ToolCall => ({ name, input: {} });

/** Each step's calls, in `implement`'s order. */
const STEPS: [string, ToolCall[]][] = [
  [IMPLEMENT_STEP.read, [shell("gh issue view 595 --json number,title,body")]],
  [
    IMPLEMENT_STEP.branch,
    [shell("git fetch origin; git switch -c feat/595-step origin/develop")],
  ],
  [IMPLEMENT_STEP.standards, [skill("coding-standards")]],
  [IMPLEMENT_STEP.build, [skill("mattpocock-skills:tdd"), tool("Edit")]],
  [
    IMPLEMENT_STEP.commit,
    [
      shell("git commit -F .scratch/msg.txt; git push -u origin HEAD"),
      shell(
        'gh issue comment 595 --body "Progress: built, next is review (step 7)"',
      ),
    ],
  ],
  [IMPLEMENT_STEP.review, [skill("mattpocock-skills:code-review")]],
  [
    IMPLEMENT_STEP.ship,
    [shell("gh pr create --base develop --body-file .scratch/pr.md")],
  ],
  [IMPLEMENT_STEP.ci, [shell("node .claude/scripts/wait-checks.mjs 607")]],
];

/** `implement` started, then every step's calls up to and including `step`. */
const through = (step: string): ToolCall[] => {
  const upTo = STEPS.findIndex(([s]) => s === step);
  return [
    skill("implement"),
    ...STEPS.slice(0, upTo + 1).flatMap(([, calls]) => calls),
  ];
};

describe("implementStepOfCalls", () => {
  it.each(STEPS.map(([step]) => step))(
    "reads %s once its calls are made",
    (step) => {
      expect(implementStepOfCalls(through(step))).toBe(step);
    },
  );

  it("reads no step for a card that never invoked implement", () => {
    expect(
      implementStepOfCalls([
        tool("Read"),
        shell("gh issue view 12"),
        shell("gh pr create --fill"),
      ]),
    ).toBeNull();
  });

  it("reads unknown before the first step's call", () => {
    expect(implementStepOfCalls([skill("implement"), tool("Read")])).toBe(
      IMPLEMENT_STEP.unknown,
    );
  });

  it("reads unknown when a step is missing, rather than the furthest step seen", () => {
    expect(
      implementStepOfCalls([
        skill("implement"),
        shell("gh issue view 595"),
        shell("gh pr create --fill"),
      ]),
    ).toBe(IMPLEMENT_STEP.unknown);
  });

  it("stays on build through a slice's commit, which build makes too", () => {
    expect(
      implementStepOfCalls([
        ...through(IMPLEMENT_STEP.build),
        shell("git commit -F .scratch/msg.txt; git push"),
        shell(
          'gh issue comment 595 --body "Progress: building, next is the next slice (step 4)"',
        ),
      ]),
    ).toBe(IMPLEMENT_STEP.build);
  });

  it("reads build from an edit without the tdd skill", () => {
    expect(
      implementStepOfCalls([
        ...through(IMPLEMENT_STEP.standards),
        tool("Write"),
      ]),
    ).toBe(IMPLEMENT_STEP.build);
  });

  it("keeps the furthest step while review's fixes edit and commit again", () => {
    expect(
      implementStepOfCalls([
        ...through(IMPLEMENT_STEP.review),
        tool("Edit"),
        shell("git commit -F .scratch/fix.txt"),
      ]),
    ).toBe(IMPLEMENT_STEP.review);
  });

  it.each(["gh pr checks 607 --watch", "gh run watch 40058941458 --compact"])(
    "reads CI from %s, which waited on checks before wait-checks.mjs",
    (command) => {
      expect(
        implementStepOfCalls([...through(IMPLEMENT_STEP.ship), shell(command)]),
      ).toBe(IMPLEMENT_STEP.ci);
    },
  );

  it("reads Bash's commands as it reads PowerShell's", () => {
    expect(
      implementStepOfCalls([
        skill("implement"),
        { name: "Bash", input: { command: "gh issue view 595" } },
      ]),
    ).toBe(IMPLEMENT_STEP.read);
  });

  it("counts only the calls made since implement was last invoked", () => {
    expect(
      implementStepOfCalls([
        ...through(IMPLEMENT_STEP.ci),
        skill("implement"),
        shell("gh issue view 596"),
      ]),
    ).toBe(IMPLEMENT_STEP.read);
  });

  it("ignores a call whose input is not the shape its tool takes", () => {
    expect(
      implementStepOfCalls([
        skill("implement"),
        { name: "PowerShell", input: null },
        { name: "Skill", input: { skill: 7 } },
        shell("gh issue view 595"),
      ]),
    ).toBe(IMPLEMENT_STEP.read);
  });
});
