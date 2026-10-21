import { useId, type ReactNode } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { extractErrorMessage } from "@/lib/errors";
import { useSessions } from "./dev-api";
import {
  NO_MODEL,
  NO_SESSIONS_LEAD,
  NO_TASK,
  REFRESHING_LABEL,
  REFRESH_LABEL,
  SESSIONS_LOAD_FAILED,
  SESSIONS_TITLE,
  SESSION_KIND_LABEL,
  formatElapsed,
  outputTokens,
  sessionCount,
  subagentsLabel,
} from "./sessions-copy";
import {
  SESSION_STATE,
  type SessionCard,
  type SessionsReport,
} from "./sessions-protocol";

/**
 * This repository's Claude Code sessions on this machine, each a card with
 * every subagent it started nested under it (#590, slice 1 of
 * `docs/plans/dev-tools-sessions-page.md`).
 *
 * Read on load and on Refresh, like the project map — a query, not a stream:
 * the page is a snapshot until a later slice makes it follow a session live.
 * It talks only to the Vite dev server (`apps/web/dev/sessions.ts`), so it
 * opens with the API and the database stopped.
 */
export function SessionsPage() {
  const { data, isPending, error, refetch, isFetching } = useSessions();

  return (
    /* Block layout with `space-y`, for the reason `TestRunnerPage` gives. */
    <main className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{SESSIONS_TITLE}</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            This repository&rsquo;s Claude Code sessions on this machine, each
            with the subagents it started nested under it, read off the
            transcripts when the page opens and when you press {REFRESH_LABEL}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">dev only</Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            {isFetching ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : (
              <RefreshCw aria-hidden="true" />
            )}
            {isFetching ? REFRESHING_LABEL : REFRESH_LABEL}
          </Button>
        </div>
      </div>

      {isPending ? (
        <SessionsSkeleton />
      ) : error || !data ? (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {extractErrorMessage(error, SESSIONS_LOAD_FAILED)}
        </p>
      ) : (
        <Reading report={data} />
      )}
    </main>
  );
}

function Reading({ report }: { report: SessionsReport }) {
  return (
    <>
      <p
        aria-live="polite"
        className="rounded-lg bg-card px-3 py-2 text-sm ring-1 ring-border"
      >
        {sessionCount(report.sessions.length)} read from{" "}
        <code className="font-mono text-xs">{report.transcriptDir}</code> at{" "}
        {new Date(report.gatheredAt).toLocaleTimeString("en-GB")}.
      </p>

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
            <Badge
              variant={
                card.state === SESSION_STATE.running ? "secondary" : "outline"
              }
            >
              {card.state}
            </Badge>
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
