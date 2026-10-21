import { useId } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { WELCOME_REPOSITORY } from "@/lib/welcome";
import {
  CHAIN_TITLE,
  CHAIN_WORKERS_LABEL,
  NO_WORKERS,
  blockedBy,
  chainIssuesLabel,
  workerOn,
} from "./sessions-copy";
import {
  CHAIN_ISSUE_STATE,
  type ChainIssue,
  type ChainIssueState,
  type ChainView,
  type ChainWorker,
} from "./sessions-protocol";
import { STATE_BADGE } from "./session-visuals";

/** An issue's badge: Next in the primary fill, as the one to watch for,
 *  In progress filled, Blocked the one that alarms, the rest quiet. */
const ISSUE_BADGE = {
  [CHAIN_ISSUE_STATE.merged]: "outline",
  [CHAIN_ISSUE_STATE.inProgress]: "secondary",
  [CHAIN_ISSUE_STATE.next]: "default",
  [CHAIN_ISSUE_STATE.waiting]: "outline",
  [CHAIN_ISSUE_STATE.blocked]: "destructive",
} as const satisfies Record<ChainIssueState, string>;

/**
 * Every running `/chain`, each its issues in the order the chain works them
 * and where each stands (#594, R8), or, when the order can't be known, why
 * and the workers its conductor started.
 */
export function SessionChains({ chains }: { chains: ChainView[] }) {
  if (chains.length === 0) return null;
  return (
    <div className="space-y-3">
      {chains.map((chain) => (
        <Chain key={chain.sessionId} chain={chain} />
      ))}
    </div>
  );
}

function Chain({ chain }: { chain: ChainView }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} data-chain={chain.sessionId}>
      <Card size="sm">
        <CardContent className="space-y-2">
          <h2 id={headingId} className="text-base font-semibold">
            {CHAIN_TITLE}
            {chain.plan !== null && (
              <>
                {" "}
                <code className="font-mono text-xs font-normal">
                  {chain.plan}
                </code>
              </>
            )}
          </h2>
          {chain.issues !== null ? (
            <ol aria-label={chainIssuesLabel(chain.plan)} className="space-y-1">
              {chain.issues.map((issue) => (
                <IssueRow key={issue.issue} issue={issue} />
              ))}
            </ol>
          ) : (
            <>
              <p
                data-chain-unknown
                className="max-w-prose text-sm text-muted-foreground"
              >
                {chain.unknown}
              </p>
              <Workers workers={chain.workers} />
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function IssueRow({ issue }: { issue: ChainIssue }) {
  return (
    <li
      data-chain-issue={issue.issue}
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
    >
      <a
        href={`${WELCOME_REPOSITORY.href}/issues/${issue.issue}`}
        target="_blank"
        rel="noreferrer"
        className="text-link tabular-nums underline-offset-4 hover:underline"
      >
        #{issue.issue}
      </a>
      <span className="min-w-0 break-words">{issue.title}</span>
      <Badge data-chain-state variant={ISSUE_BADGE[issue.state]}>
        {issue.state}
      </Badge>
      {issue.worker !== null && (
        <span
          data-chain-worker={issue.worker}
          className="text-muted-foreground"
        >
          {issue.worker}
        </span>
      )}
      {issue.blockers.length > 0 && (
        <span className="text-muted-foreground">
          {blockedBy(issue.blockers)}
        </span>
      )}
    </li>
  );
}

function Workers({ workers }: { workers: ChainWorker[] }) {
  if (workers.length === 0) {
    return <p className="text-sm text-muted-foreground">{NO_WORKERS}</p>;
  }
  return (
    <ul aria-label={CHAIN_WORKERS_LABEL} className="space-y-1">
      {workers.map((worker) => (
        <li
          key={`${worker.name}:${worker.issue}`}
          data-chain-worker={worker.name}
          className="flex flex-wrap items-center gap-2 text-sm"
        >
          <span>{workerOn(worker.name, worker.issue)}</span>
          {worker.state !== null && (
            <Badge variant={STATE_BADGE[worker.state]}>{worker.state}</Badge>
          )}
        </li>
      ))}
    </ul>
  );
}
