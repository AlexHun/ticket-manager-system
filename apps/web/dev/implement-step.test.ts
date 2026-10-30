import { readFileSync } from "node:fs";
import { join } from "node:path";
import { partialCheckout } from "@ticket/repo-scan/checkout";
import { describe, expect, it } from "vitest";
import {
  IMPLEMENT_STARTED,
  implementStepOfCalls,
  marksOf,
  marksOfPrompt,
  type ToolCall,
} from "./implement-step.ts";
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
        'gh issue comment 595 --body "Progress: built, next is the look (step 7)"',
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

/** Every `Progress:` comment the skill tells a worker to leave, as written. */
const skillComments = (): string[] =>
  readFileSync(
    join(import.meta.dirname, "../../../.claude/skills/implement/SKILL.md"),
    "utf8",
  ).match(/Progress: [^"`]+/g) ?? [];

// The skill's own text, not a copy of it: a reworded comment fails here
// rather than reading Unknown from Review on, on every card.
describe.skipIf(partialCheckout)("the skill's Progress comments", () => {
  const comments = partialCheckout ? [] : skillComments();
  const marksOfComment = (text: string) =>
    marksOf(shell(`gh issue comment 595 --body "${text}"`));

  it("marks commit for step 6's comment and nothing for the others", () => {
    expect(comments.map((text) => [text, marksOfComment(text)])).toEqual(
      comments.map((text) => [
        text,
        text.startsWith("Progress: built") ? [IMPLEMENT_STEP.commit] : [],
      ]),
    );
  });

  it("leaves one comment per checkpoint, the look step's among them", () => {
    expect(comments.map((text) => text.split(",")[0])).toEqual([
      "Progress: building",
      "Progress: built",
      "Progress: looked",
      "Progress: reviewed",
    ]);
  });
});

describe("marksOfPrompt", () => {
  it("marks implement started for a prompt that opens on its tags, in either order", () => {
    expect(
      marksOfPrompt(
        "<command-message>implement</command-message>\n<command-name>/implement</command-name>\n<command-args>682</command-args>",
      ),
    ).toEqual([IMPLEMENT_STARTED]);
    expect(
      marksOfPrompt(
        "<command-name>/implement</command-name>\n<command-message>implement</command-message>",
      ),
    ).toEqual([IMPLEMENT_STARTED]);
  });

  it("marks nothing for a prompt that only quotes the markup further in (#682)", () => {
    expect(
      marksOfPrompt(
        "It is recorded as <command-name>/implement</command-name>, see?",
      ),
    ).toEqual([]);
    expect(
      marksOfPrompt(
        "<bash-stdout>a.jsonl: <command-name>/implement</command-name></bash-stdout><bash-stderr></bash-stderr>",
      ),
    ).toEqual([]);
  });
});
