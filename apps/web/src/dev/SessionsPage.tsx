import { useId, type ReactNode } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  NO_MODEL,
  NO_SESSIONS_LEAD,
  NO_TASK,
  SESSIONS_RECONNECTING,
  SESSIONS_STREAM_LOST,
  SESSIONS_TITLE,
  SESSION_KIND_LABEL,
  formatElapsed,
  idleTime,
  outputTokens,
  sessionCount,
  subagentsLabel,
} from "./sessions-copy";
import {
  SESSION_IDLE_MS,
  SESSION_STATE,
  type SessionCard,
  type SessionState,
  type SessionsReport,
} from "./sessions-protocol";
import { useSessionsStream } from "./use-sessions-stream";

/** A state's badge: Running filled, Done quiet, Stopped the one that alarms. */
const STATE_BADGE = {
  [SESSION_STATE.running]: "secondary",
  [SESSION_STATE.done]: "outline",
  [SESSION_STATE.stopped]: "destructive",
} as const satisfies Record<SessionState, string>;

/**
 * This repository's Claude Code sessions on this machine, each a card with
 * every subagent it started nested under it (#590, slice 1 of
 * `docs/plans/dev-tools-sessions-page.md`), following them as they run
 * (#591, slice 2): a new subagent, new tokens and a change of state reach the
 * open page within 5 seconds, without a reload.
 *
 * It talks only to the Vite dev server (`apps/web/dev/sessions-stream.ts`),
 * so it opens with the API and the database stopped.
 */
export function SessionsPage() {
  const { report, problem, lost } = useSessionsStream();

  return (
    /* Block layout with `space-y`, for the reason `TestRunnerPage` gives. */
    <main className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{SESSIONS_TITLE}</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            This repository&rsquo;s Claude Code sessions on this machine, each
            with the subagents it started nested under it, followed live off the
            transcripts while the page is open. One that has written nothing for{" "}
            {idleTime(SESSION_IDLE_MS)} without finishing reads{" "}
            {SESSION_STATE.stopped}.
          </p>
        </div>
        <Badge variant="outline">dev only</Badge>
      </div>

      {report ? (
        <Reading report={report} problem={problem} lost={lost} />
      ) : lost ? (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {SESSIONS_STREAM_LOST}
        </p>
      ) : (
        <SessionsSkeleton />
      )}
    </main>
  );
}

function Reading({
  report,
  problem,
  lost,
}: {
  report: SessionsReport;
  problem: string | null;
  lost: boolean;
}) {
  return (
    <>
      {/* Not a live region: while a session runs this line changes every few
          seconds, and announcing each reading would drown the page. Only
          losing the stream is announced. */}
      <p className="flex flex-wrap items-center gap-x-2 rounded-lg bg-card px-3 py-2 text-sm ring-1 ring-border">
        <span>
          {sessionCount(report.sessions.length)} read from{" "}
          <code className="font-mono text-xs">{report.transcriptDir}</code>,
          last changed at{" "}
          {new Date(report.gatheredAt).toLocaleTimeString("en-GB")}.
        </span>
        {/* Mounted throughout, so the region exists before its words do. */}
        <span
          role="status"
          className="flex items-center gap-1 text-muted-foreground"
        >
          {lost && (
            <>
              <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
              {SESSIONS_RECONNECTING}
            </>
          )}
        </span>
      </p>

      {problem && (
        <p className="flex items-start gap-2 rounded-md px-3 py-2 text-sm text-status-warning ring-1 ring-status-warning/30">
          <AlertTriangle
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0"
          />
          <span>{problem}</span>
        </p>
      )}

      {/* A file the reading could not use, named rather than swallowed: the
          layout is undocumented and moves between Claude Code versions, and
          one bad file must never cost the page. */}
      {report.warnings.map((warning) => (
        <p
          key={`${warning.file}:${warning.message}`}
          data-sessions-warning={warning.file}
          className="flex items-start gap-2 rounded-md px-3 py-2 text-sm text-status-warning ring-1 ring-status-warning/30"
        >
          <AlertTriangle
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0"
          />
          <span>
            <code className="font-mono text-xs">{warning.file}</code>:{" "}
            {warning.message}
          </span>
        </p>
      ))}

      {report.sessions.length === 0 ? (
        <p className="max-w-prose text-sm text-muted-foreground">
          {NO_SESSIONS_LEAD}{" "}
          <code className="font-mono text-xs">{report.transcriptDir}</code> yet.
          A session appears here once Claude Code has worked in this repository.
        </p>
      ) : (
        <ol className="space-y-3">
          {report.sessions.map((session) => (
            <li key={session.id}>
              <Card size="sm">
                <CardContent>
                  <CardBody card={session} depth={0} />
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

/** A card's heading level by its depth, the session's being `h2` under the
 *  page's `h1`, so the outline follows the tree. Past `h6` it stays there. */
const HEADINGS = ["h2", "h3", "h4", "h5", "h6"] as const;

/**
 * One card's facts, then the subagents under it, recursively.
 *
 * Only a session is a `Card`. Its subagents are an indented list inside it, a
 * rule down the left marking each level, rather than a card in a card in a
 * card (design.md): the nesting is the tree, and the rule already says what is
 * under what.
 */
function CardBody({ card, depth }: { card: SessionCard; depth: number }) {
  const headingId = useId();
  const task = card.task ?? NO_TASK;
  const Heading = HEADINGS[Math.min(depth, HEADINGS.length - 1)];
  return (
    <article
      aria-labelledby={headingId}
      data-session-card={card.id}
      className="space-y-2"
    >
      <div className="space-y-1">
        <Heading
          id={headingId}
          className="text-sm font-medium text-balance break-words"
        >
          {task}
        </Heading>
        <dl className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <Fact label="Type">{card.subagentType ?? SESSION_KIND_LABEL}</Fact>
          <Fact label="Model">{card.model ?? NO_MODEL}</Fact>
          <Fact label="State">
            <Badge variant={STATE_BADGE[card.state]}>{card.state}</Badge>
          </Fact>
          <Fact label="Elapsed" numeric>
            {formatElapsed(card.elapsedMs)}
          </Fact>
          <Fact label="Own output" numeric>
            {outputTokens(card.out)}
          </Fact>
        </dl>
      </div>
      {card.children.length > 0 && (
        <ol
          aria-label={subagentsLabel(task)}
          className="space-y-3 border-l border-border pl-4"
        >
          {card.children.map((child) => (
            <li key={child.id}>
              <CardBody card={child} depth={depth + 1} />
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

function Fact({
  label,
  numeric = false,
  children,
}: {
  label: string;
  numeric?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1">
      <dt className="sr-only">{label}</dt>
      <dd
        data-session-fact={label}
        className={numeric ? "tabular-nums" : undefined}
      >
        {children}
      </dd>
    </div>
  );
}

function SessionsSkeleton() {
  return (
    <div
      className="space-y-3"
      aria-busy="true"
      aria-label="Reading the sessions"
    >
      <Skeleton className="h-9 w-full" />
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-20 w-full" />
      ))}
    </div>
  );
}
