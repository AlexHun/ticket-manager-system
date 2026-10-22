import type {
  SessionCard,
  SessionGroup,
  SessionSlice,
  SessionState,
} from "./sessions-protocol";

/** The filter's choice that keeps every session: not a state, so a token of
 *  its own, as `ANY_FACET` is the Usage bar's. */
export const ALL_STATES = "all";
export type StateChoice = SessionState | typeof ALL_STATES;

/** Whether a card, or any subagent under it, is in `state`. */
const holds = (card: SessionCard, state: SessionState): boolean =>
  card.state === state || card.children.some((child) => holds(child, state));

/**
 * Whether the session a slice names holds a card in `state`. Read off the
 * card's tree, not the slice's: a group's slice carries only the subagents
 * that worked on its branches, and a session waiting on you is waiting in
 * every group it is in.
 */
const sessionHolds = (
  slice: SessionSlice,
  cards: Map<string, SessionCard>,
  state: SessionState,
): boolean => {
  const card = cards.get(slice.id);
  return card !== undefined && holds(card, state);
};

/**
 * The groups as the state filter shows them (#613): each session kept whole
 * when it or a subagent under it is in `choice`, and a group left with none
 * dropped. A group keeps its total, which is the issue's whatever is shown,
 * so it still matches the Usage page.
 */
export function filterGroups(
  groups: SessionGroup[],
  cards: Map<string, SessionCard>,
  choice: StateChoice,
): SessionGroup[] {
  if (choice === ALL_STATES) return groups;
  return groups.flatMap((group) => {
    const sessions = group.sessions.filter((slice) =>
      sessionHolds(slice, cards, choice),
    );
    return sessions.length > 0 ? [{ ...group, sessions }] : [];
  });
}
