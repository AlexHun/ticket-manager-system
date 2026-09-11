import { EVAL_CORPUS, type EvalCorpus } from "@ticket/shared";

/**
 * What each corpus is called on screen.
 *
 * One map rather than one per component, and it is the same rule
 * `pipeline-labels.ts` keeps for the decline reasons: two carefully-worded
 * copies are two copies that eventually disagree, and this pair had already
 * started to — the runs list said "Live articles" while the schedule panel
 * beside it said "Live corpus", for the same value, on the same screen.
 *
 * A `Record`, so a third corpus is a compile error here until somebody has
 * written a word for it.
 */
export const CORPUS_LABEL: Record<EvalCorpus, string> = {
  [EVAL_CORPUS.frozen]: "Frozen corpus",
  [EVAL_CORPUS.live]: "Live articles",
};
