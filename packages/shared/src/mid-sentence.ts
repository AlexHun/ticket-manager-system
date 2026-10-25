/**
 * A label as it reads after a dash mid-sentence: "Declined — not covered by
 * the knowledge base".
 *
 * A label written to stand alone opens on a capital; run on after a dash it
 * reads lower-case. The activity feed and the Evals verdict run `DECLINE_SHORT`
 * through it, and the outbox's refusal to retry a withheld email runs
 * `WITHHELD_REASON` through it. A label that opens on an acronym of two or
 * more capitals ("AI …") keeps them, or it would read "aI …". A one-letter
 * word that must stay capital ("I …") is not detected and would be lowered;
 * no label opens on one.
 *
 * Here rather than in the web app (#531): the API builds a sentence the same
 * way and cannot import from `apps/web`.
 */
export function midSentence(label: string): string {
  if (/^[A-Z]{2}/.test(label)) return label;
  return label.charAt(0).toLowerCase() + label.slice(1);
}
