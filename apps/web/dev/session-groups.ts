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

/** The key of the group a branch's work is in. */
function groupKeyOf(branch: string | null): string {
  if (branch !== null && BASE.has(branch)) return SESSION_GROUP_KIND.base;
  const issue = branch === null ? null : issueOfBranch(branch);
  return issue === null
    ? SESSION_GROUP_KIND.other
    : `${SESSION_GROUP_KIND.issue}:${issue}`;
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
        responses.set(r.id, {
          ...before,
          out: Math.max(before.out, r.out),
          cacheRead: Math.max(before.cacheRead, r.cacheRead),
        });
      }
    }
    c.children.forEach(visit);
  };
  roots.forEach(visit);

  const shares = new Map<CreditedCard, CardShares>();
  const place = (c: CreditedCard, parentHome: string | null) => {
    const home =
      c.branch !== null
        ? groupKeyOf(c.branch)
        : (parentHome ?? SESSION_GROUP_KIND.other);
    shares.set(c, { byGroup: new Map(), home });
    c.children.forEach((child) => place(child, home));
  };
  roots.forEach((root) => place(root, null));

  for (const [id, r] of responses) {
    const card = creditedTo.get(id)!;
    const { byGroup } = shares.get(card)!;
    const key = groupKeyOf(r.branch);
    byGroup.set(key, (byGroup.get(key) ?? 0) + r.out);
  }
  return { responses: [...responses.values()], shares };
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
  const { responses, shares } = creditAll(roots);
  const { byIssue } = tallySpend(responses);

  const keys = new Set<string>();
  for (const s of shares.values()) {
    keys.add(s.home);
    for (const key of s.byGroup.keys()) keys.add(key);
  }

  const groups: { group: SessionGroup; first: number }[] = [];
  for (const key of keys) {
    const sessions: SessionSlice[] = [];
    let first = Infinity;
    roots.forEach((root, i) => {
      const slice = sliceOf(root, key, shares);
      if (!slice) return;
      sessions.push(slice);
      first = Math.min(first, i);
    });
    if (sessions.length === 0) continue;
    const summed = sessions.reduce((n, s) => n + s.subtreeOut, 0);
    const [kind, number] = key.split(":");
    const group: SessionGroup =
      kind === SESSION_GROUP_KIND.issue
        ? {
            key,
            kind: SESSION_GROUP_KIND.issue,
            issue: Number(number),
            // The Usage page's figure (R7), which the slices sum to.
            out: byIssue.get(Number(number))?.out ?? 0,
            sessions,
          }
        : {
            key,
            kind:
              kind === SESSION_GROUP_KIND.base
                ? SESSION_GROUP_KIND.base
                : SESSION_GROUP_KIND.other,
            out: summed,
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
