// What each card on the Sessions page spent, and on which issue (#593, slice 4
// of `docs/plans/dev-tools-sessions-page.md`): every response credited to the
// card whose transcript holds it, and the cards grouped by the branch each
// response ran on.
//
// **Per response, not per session, because a session is not on one branch.**
// Measured 2026-10-21 over this machine's 206 sessions of this repository: 162
// ran on more than one branch, and one `/chain` conductor's own records
// covered seven issue branches and `develop`. A session filed under one branch
// would carry the others' spend into the wrong issue. So a session is in the
// group of every branch its responses ran on, with its share of each, and an
// issue group's total is the issue's total.
//
// **That total is the Usage page's, by the same join** (R7): `tallySpend` over
// the responses the cards were credited from, which `./sessions.ts` keys with
// `identityOf` and folds at their largest count, as `readTranscripts` does.
// The six fields of `TranscriptResponse` are the usage history's stored row and
// the push's wire (ADR-0023), so the card a response belongs to is not a
// seventh field: it is which card's list the response is in. A response in two
// files is credited once, to the first card read; measured the same day over
// 744 transcripts, no response id was in more than one.

import {
  BASE_BRANCHES,
  SESSION_GROUP_KIND,
  type SessionGroup,
  type SessionSlice,
} from "../src/dev/sessions-protocol.ts";
import {
  issueOfBranch,
  largerCounts,
  tallySpend,
  type TranscriptResponse,
} from "./transcripts.ts";

/** One card as the grouping reads it: its own responses and where it is. */
export interface CreditedCard {
  id: string;
  /** The `gitBranch` of its transcript's latest record that carries one, or
   *  null for one with none, such as a subagent with no transcript yet. */
  branch: string | null;
  /** Its own transcript's responses, each once at its largest count. */
  responses: readonly TranscriptResponse[];
  children: readonly CreditedCard[];
}

const BASE = new Set<string>(BASE_BRANCHES);

/** `Omit` over each member of a union rather than over the union as one. */
type WithoutFigures<T> = T extends unknown
  ? Omit<T, "out" | "sessions">
  : never;

/** Which group a branch's work is in: a group less its figures, so the key is
 *  built once and never parsed back. */
type GroupId = WithoutFigures<SessionGroup>;

const BASE_GROUP: GroupId = {
  key: SESSION_GROUP_KIND.base,
  kind: SESSION_GROUP_KIND.base,
};
const OTHER_GROUP: GroupId = {
  key: SESSION_GROUP_KIND.other,
  kind: SESSION_GROUP_KIND.other,
};

/** The group a branch's work is in. */
function groupOf(branch: string | null): GroupId {
  if (branch !== null && BASE.has(branch)) return BASE_GROUP;
  const issue = branch === null ? null : issueOfBranch(branch);
  return issue === null
    ? OTHER_GROUP
    : {
        key: `${SESSION_GROUP_KIND.issue}:${issue}`,
        kind: SESSION_GROUP_KIND.issue,
        issue,
      };
}

/** What one card spent in each group it worked in, and the group it is in now. */
interface CardShares {
  byGroup: Map<string, number>;
  /** Its own branch's group, else its parent's. */
  home: string;
}

/**
 * Every response once, credited to the first card read that holds it at the
 * largest count any card's copy carries; and each card's share per group.
 */
function creditAll(roots: readonly CreditedCard[]) {
  const creditedTo = new Map<string, CreditedCard>();
  const responses = new Map<string, TranscriptResponse>();
  const visit = (c: CreditedCard) => {
    for (const r of c.responses) {
      const before = responses.get(r.id);
      if (!before) {
        responses.set(r.id, r);
        creditedTo.set(r.id, c);
      } else if (r.out > before.out || r.cacheRead > before.cacheRead) {
        responses.set(r.id, { ...before, ...largerCounts(before, r) });
      }
    }
    c.children.forEach(visit);
  };
  roots.forEach(visit);

  /** Every group any card is in, by key. */
  const groups = new Map<string, GroupId>();
  const keyOf = (id: GroupId) => {
    groups.set(id.key, id);
    return id.key;
  };
  const shares = new Map<CreditedCard, CardShares>();
  const place = (c: CreditedCard, parentHome: string | null) => {
    const home =
      c.branch !== null
        ? keyOf(groupOf(c.branch))
        : (parentHome ?? keyOf(OTHER_GROUP));
    shares.set(c, { byGroup: new Map(), home });
    c.children.forEach((child) => place(child, home));
  };
  roots.forEach((root) => place(root, null));

  for (const [id, r] of responses) {
    const card = creditedTo.get(id)!;
    const { byGroup } = shares.get(card)!;
    const key = keyOf(groupOf(r.branch));
    byGroup.set(key, (byGroup.get(key) ?? 0) + r.out);
  }
  return { responses: [...responses.values()], shares, groups };
}

/** `card`'s share of group `key`, or null when it has no part in it. */
function sliceOf(
  card: CreditedCard,
  key: string,
  shares: Map<CreditedCard, CardShares>,
): SessionSlice | null {
  const children = card.children.flatMap((c) => {
    const slice = sliceOf(c, key, shares);
    return slice ? [slice] : [];
  });
  const { byGroup, home } = shares.get(card)!;
  const own = byGroup.get(key);
  if (own === undefined && home !== key && children.length === 0) return null;
  const out = own ?? 0;
  return {
    id: card.id,
    out,
    subtreeOut: children.reduce((n, c) => n + c.subtreeOut, out),
    children,
  };
}

/** Issue groups first, then `develop` and `main`, then the rest. */
const KIND_RANK = {
  [SESSION_GROUP_KIND.issue]: 0,
  [SESSION_GROUP_KIND.base]: 1,
  [SESSION_GROUP_KIND.other]: 2,
} as const;

const issueOf = (g: SessionGroup) =>
  g.kind === SESSION_GROUP_KIND.issue ? g.issue : 0;

/**
 * `roots` grouped by the branch each response ran on: one group per issue any
 * response's branch names, one for `BASE_BRANCHES` and one for the rest, each
 * holding the sessions with a part in it. `roots` comes most recently started
 * first, and each group keeps that order; issue groups are ordered by their
 * most recently started session, then by number.
 */
export function groupSessions(roots: readonly CreditedCard[]): SessionGroup[] {
  const { responses, shares, groups: ids } = creditAll(roots);
  const { byIssue } = tallySpend(responses);

  const groups: { group: SessionGroup; first: number }[] = [];
  for (const id of ids.values()) {
    const sessions: SessionSlice[] = [];
    let first = Infinity;
    roots.forEach((root, i) => {
      const slice = sliceOf(root, id.key, shares);
      if (!slice) return;
      sessions.push(slice);
      first = Math.min(first, i);
    });
    if (sessions.length === 0) continue;
    const group: SessionGroup =
      id.kind === SESSION_GROUP_KIND.issue
        ? // The Usage page's figure (R7), which the slices sum to.
          { ...id, out: byIssue.get(id.issue)?.out ?? 0, sessions }
        : {
            ...id,
            out: sessions.reduce((n, s) => n + s.subtreeOut, 0),
            sessions,
          };
    groups.push({ group, first });
  }

  return groups
    .sort(
      (a, b) =>
        KIND_RANK[a.group.kind] - KIND_RANK[b.group.kind] ||
        a.first - b.first ||
        issueOf(a.group) - issueOf(b.group),
    )
    .map(({ group }) => group);
}
