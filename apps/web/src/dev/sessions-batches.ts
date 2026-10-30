import type { SessionGroup, SessionSlice } from "./sessions-protocol";

/**
 * How many cards the page draws before its first paint (#618). Measured
 * 2026-10-30 on this machine's 206 groups (1,230 cards, about 52k elements):
 * drawn in one commit, the first card came 14.7s after the reading, 7.9s of
 * it React and 6.3s style recalculation, both growing with the elements
 * drawn. Twenty drew it 0.53-0.8s after the reading, over three loads.
 */
export const FIRST_BATCH_CARDS = 20;

/**
 * How many cards each frame after the first adds. The page memoises what it
 * has drawn, so a batch renders only its own cards: unmemoised, every batch
 * rendered the whole page again, and 50 a frame took 75s to draw those 1,230
 * cards, against one commit's 15s. Memoised, 100 a frame drew them in 20s.
 */
export const BATCH_CARDS = 100;

/** A slice's own card and every card under it. */
const cardsUnder = (slice: SessionSlice): number =>
  1 + slice.children.reduce((n, child) => n + cardsUnder(child), 0);

/** Every card the groups draw, each session's subagents included. */
export const cardsIn = (groups: SessionGroup[]): number =>
  groups.reduce(
    (n, group) =>
      n + group.sessions.reduce((m, slice) => m + cardsUnder(slice), 0),
    0,
  );

/**
 * The groups as far as `budget` cards reach (#618), in the page's order: each
 * session whole, so a tree is never drawn in part and the first session is
 * drawn whatever its size, and the groups after the last one reached left
 * out. A group cut short keeps its total, which is the issue's whatever is
 * drawn. A budget that covers every card returns `groups` itself.
 */
export function drawnGroups(
  groups: SessionGroup[],
  budget: number,
): SessionGroup[] {
  if (cardsIn(groups) <= budget) return groups;
  const drawn: SessionGroup[] = [];
  let spent = 0;
  for (const group of groups) {
    if (spent >= budget) break;
    const sessions: SessionSlice[] = [];
    for (const slice of group.sessions) {
      if (spent >= budget) break;
      sessions.push(slice);
      spent += cardsUnder(slice);
    }
    drawn.push(
      sessions.length === group.sessions.length
        ? group
        : { ...group, sessions },
    );
  }
  return drawn;
}
