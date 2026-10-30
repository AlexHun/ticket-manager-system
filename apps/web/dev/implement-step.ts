// Which step of the `implement` skill a card has reached, read off the tool
// calls its transcript holds — slice 6 of
// `docs/plans/dev-tools-sessions-page.md` (#595, R9).
//
// The steps are R9's eight, which are `.claude/skills/implement/SKILL.md`'s
// with three differences: the skill's step 5 (mark the PRD shipped) has no
// step of its own, so a worker there still reads Build; nor has its step 7
// (look at the page, #626), whose `Progress: looked` comment matches no rule,
// so a worker there still reads Commit; and its step 9 is two here, Ship once
// the PR is opened and CI once its checks are watched.
// Each is matched by the call the skill tells the worker to make:
//
// | Step            | The call                                              |
// | --------------- | ----------------------------------------------------- |
// | Read the ticket | `gh issue view`                                       |
// | Branch          | `git switch` or `git checkout`                        |
// | Standards       | the `coding-standards` skill                          |
// | Build           | the `tdd` skill, or an `Edit`, `Write` or notebook edit |
// | Commit          | the `Progress: built` comment step 6 leaves           |
// | Review          | the `code-review` skill                               |
// | Ship            | `gh pr create`                                        |
// | CI              | `wait-checks.mjs`, `gh pr checks`, or `gh run watch`, `rerun` or `view` |
//
// A card is on the furthest step it has made a call of, counted from the
// last time it invoked `implement` (a `Skill` call, or a `/implement`
// prompt the reader turns into one). Commit is the comment, not a
// `git commit`, because step 4 commits every slice too: a commit alone says
// nothing about which of the two it was. The comment is matched in the
// command, as step 6 writes it (`--body "Progress: built…"`); one posted
// with `--body-file` names no text to match, and the card reads Unknown from
// Review on.
//
// **A sequence the rules don't recognise reads Unknown, never the nearest
// guess** (the PRD's third risk): a card that invoked `implement` and has made
// no step's call yet, or whose furthest step has one before it with no call —
// a step skipped, a rule an edit to the skill moved, or a ticket resumed
// mid-way in a fresh subagent, which starts again from its last `Progress:`
// comment rather than from step 1. A card that never invoked it reads no
// step at all.
//
// Pure, so each rule is a unit test over made-up calls
// (`./implement-step.test.ts`), and an edit to the skill that changes a call
// breaks a test before it misleads the page. The `Progress:` comments are
// also read off the skill itself there, so a reworded one fails a test too.

import {
  IMPLEMENT_STEP,
  type ImplementStep,
} from "../src/dev/sessions-protocol.ts";
import { commandOf } from "./command-prompt.ts";

/** A step a call can show, which is every step but Unknown. */
type KnownStep = Exclude<ImplementStep, typeof IMPLEMENT_STEP.unknown>;

/** `implement`'s steps in its order. */
const ORDER: readonly KnownStep[] = [
  IMPLEMENT_STEP.read,
  IMPLEMENT_STEP.branch,
  IMPLEMENT_STEP.standards,
  IMPLEMENT_STEP.build,
  IMPLEMENT_STEP.commit,
  IMPLEMENT_STEP.review,
  IMPLEMENT_STEP.ship,
  IMPLEMENT_STEP.ci,
];

/** The mark of `implement` being invoked, which the steps count from. */
export const IMPLEMENT_STARTED = "started";

/** What one call says: that `implement` started, or that a step was made. */
export type StepMark = typeof IMPLEMENT_STARTED | KnownStep;

/** A tool call as a transcript's `tool_use` block holds it. */
export interface ToolCall {
  name: string;
  input: unknown;
}

/** A skill's name without its plugin's prefix: `mattpocock-skills:tdd` → `tdd`. */
const bareSkill = (name: string) => name.slice(name.lastIndexOf(":") + 1);

const SKILL_STEPS: Record<string, StepMark> = {
  implement: IMPLEMENT_STARTED,
  "coding-standards": IMPLEMENT_STEP.standards,
  tdd: IMPLEMENT_STEP.build,
  "code-review": IMPLEMENT_STEP.review,
};

const EDIT_TOOLS = new Set(["Edit", "Write", "NotebookEdit"]);

/** A shell command's steps. One command may make several (`git fetch; git
 *  switch -c …`), and each is a mark. */
const COMMAND_STEPS: [RegExp, KnownStep][] = [
  [/\bgh\s+issue\s+view\b/, IMPLEMENT_STEP.read],
  [/\bgit\s+(?:switch|checkout)\b/, IMPLEMENT_STEP.branch],
  [
    /\bgh\s+issue\s+comment\b[\s\S]*\bProgress:\s*built\b/,
    IMPLEMENT_STEP.commit,
  ],
  [/\bgh\s+pr\s+create\b/, IMPLEMENT_STEP.ship],
  [
    /\bwait-checks\.mjs\b|\bgh\s+(?:pr\s+checks|run\s+(?:watch|rerun|view))\b/,
    IMPLEMENT_STEP.ci,
  ],
];

const field = (input: unknown, key: string): string | null => {
  const value = (input as Record<string, unknown> | null)?.[key];
  return typeof value === "string" ? value : null;
};

/** What one call says about `implement`'s progress: nothing, for most. */
export function marksOf({ name, input }: ToolCall): StepMark[] {
  if (name === "Skill") {
    const skill = field(input, "skill");
    const mark = skill === null ? undefined : SKILL_STEPS[bareSkill(skill)];
    return mark ? [mark] : [];
  }
  if (EDIT_TOOLS.has(name)) return [IMPLEMENT_STEP.build];
  const command = field(input, "command");
  if (command === null) return [];
  return COMMAND_STEPS.filter(([rule]) => rule.test(command)).map(
    ([, step]) => step,
  );
}

/** What one prompt says: that `implement` started, when it ran the
 *  command, as a `Skill` call does in a subagent. */
export const marksOfPrompt = (text: string): StepMark[] =>
  commandOf(text)?.name === "/implement" ? [IMPLEMENT_STARTED] : [];

/**
 * The step `marks` add up to, in the order the calls were made: null when
 * `implement` never started, Unknown when the marks since it last did are not
 * a run of its steps from the first.
 */
export function implementStepOf(
  marks: readonly StepMark[],
): ImplementStep | null {
  const start = marks.lastIndexOf(IMPLEMENT_STARTED);
  if (start === -1) return null;
  const made = new Set(marks.slice(start + 1));
  let furthest = -1;
  ORDER.forEach((step, i) => {
    if (made.has(step)) furthest = i;
  });
  if (furthest === -1) return IMPLEMENT_STEP.unknown;
  const gapless = ORDER.slice(0, furthest).every((step) => made.has(step));
  return gapless ? ORDER[furthest]! : IMPLEMENT_STEP.unknown;
}

/** The step a list of calls has reached. */
export const implementStepOfCalls = (calls: readonly ToolCall[]) =>
  implementStepOf(calls.flatMap(marksOf));
