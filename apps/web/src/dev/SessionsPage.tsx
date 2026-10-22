import { useId, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, ChevronRight, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { WELCOME_REPOSITORY } from "@/lib/welcome";
import { cn } from "@/lib/utils";
import {
  BASE_GROUP_NOTE,
  BASE_GROUP_TITLE,
  NO_MODEL,
  NO_SESSIONS_IN_STATE,
  NO_SESSIONS_LEAD,
  NO_TASK,
  NO_TOOLS,
  OTHER_GROUP_NOTE,
  OTHER_GROUP_TITLE,
  SESSIONS_HOW_LABEL,
  SESSIONS_LEAD,
  SESSIONS_RECONNECTING,
  SESSIONS_STREAM_CLOSED,
  SESSIONS_TITLE,
  SESSION_KIND_LABEL,
  STATE_FILTER_ALL,
  STATE_FILTER_LABEL,
  STEP_UNKNOWN,
  TOOLS_LABEL,
  formatElapsed,
  idleTime,
  issueGroupTitle,
  outputTokens,
  sessionCount,
  stepLabel,
  subagentsLabel,
  toggleSubagentsLabel,
  toolCallCount,
  waitingCount,
  withSubagents,
} from "./sessions-copy";
import {
  IMPLEMENT_STEP,
  SESSION_GROUP_KIND,
  SESSION_IDLE_MS,
  SESSION_STATE,
  type ImplementStep,
  type SessionCard,
  type SessionGroup,
  type SessionSlice,
  type SessionsReport,
  type ToolTally,
} from "./sessions-protocol";
import { SessionChains } from "./SessionChains";
import { ALL_STATES, filterGroups, type StateChoice } from "./sessions-filter";
import { STATE_BADGE } from "./session-visuals";
import {
  useSessionsStream,
  type SessionsConnection,
} from "./use-sessions-stream";

/**
 * This repository's Claude Code sessions on this machine, each a card with
 * every subagent it started nested under it (#590, slice 1 of
 * `docs/plans/dev-tools-sessions-page.md`), following them as they run
 * (#591, slice 2): a new subagent, new tokens and a change of state reach the
 * open page within 5 seconds, without a reload. A card held on the developer
 * reads Waiting for you, and the header counts them (#592, slice 3). The
 * sessions are grouped by the issue each response's branch names, every card
 * showing what it and its subagents spent there, and an issue's total is the
 * Usage page's (#593, slice 4). A running `/chain` lists its issues in the
 * order it works them, each merged, in progress, next, waiting or blocked
 * (#594, slice 5). Each card lists the tools it has called, and one running
 * `implement` the step it has reached (#595, slice 6). Since #613 a card ranks
 * its facts, the page filters by state, and what is read once folds away.
 *
 * It talks only to the Vite dev server (`apps/web/dev/sessions-stream.ts`),
 * so it opens with the API and the database stopped.
 */
export function SessionsPage() {
  const { report, problem, connection } = useSessionsStream();
  const waiting = report ? countWaiting(report.sessions) : 0;
  const [howOpen, setHowOpen] = useState(false);

  return (
    /* Block layout with `space-y`, for the reason `TestRunnerPage` gives. */
    <main className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">{SESSIONS_TITLE}</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            {SESSIONS_LEAD}
          </p>
          {/* The rest is read once, so it starts folded rather than standing
              above the sessions on every visit (#613). */}
          <Collapsible open={howOpen} onOpenChange={setHowOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="xs" className="-ml-2">
                <ChevronRight
                  aria-hidden="true"
                  data-icon="inline-start"
                  className={cn("transition-transform", howOpen && "rotate-90")}
                />
                {SESSIONS_HOW_LABEL}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <p
                data-sessions-how
                className="max-w-prose pt-1 text-sm text-muted-foreground"
              >
                They are grouped by the issue each response&rsquo;s branch
                names, so a session that worked on several issues shows under
                each with its share of it, and an issue&rsquo;s total matches
                the Usage page. One held on a permission prompt or a question to
                you reads {SESSION_STATE.waiting}. One that has written nothing
                for {idleTime(SESSION_IDLE_MS)} without finishing reads{" "}
                {SESSION_STATE.stopped}. A running /chain lists its issues above
                them, in the order it works them.
              </p>
            </CollapsibleContent>
          </Collapsible>
        </div>
        <div className="flex items-center gap-2">
          {/* A live region, mounted throughout so it exists before its words
              do: unlike the reading's line below, this changes only when
              something starts or stops waiting on the developer, which is
              worth announcing. */}
          <span role="status" data-sessions-waiting={waiting}>
            {waiting > 0 && <Badge>{waitingCount(waiting)}</Badge>}
          </span>
          <Badge variant="outline">dev only</Badge>
        </div>
      </div>

      {report ? (
        <Reading report={report} problem={problem} connection={connection} />
      ) : connection === "open" ? (
        <SessionsSkeleton />
      ) : (
        <p
          role="status"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {CONNECTION_WORDS[connection]}
        </p>
      )}
    </main>
  );
}

/** How many cards, at any depth, read Waiting for you. */
const countWaiting = (cards: SessionCard[]): number =>
  cards.reduce(
    (n, card) =>
      n +
      (card.state === SESSION_STATE.waiting ? 1 : 0) +
      countWaiting(card.children),
    0,
  );

/** What the page says while the stream is not open. */
const CONNECTION_WORDS = {
  reconnecting: SESSIONS_RECONNECTING,
  closed: SESSIONS_STREAM_CLOSED,
} as const satisfies Record<Exclude<SessionsConnection, "open">, string>;

function Reading({
  report,
  problem,
  connection,
}: {
  report: SessionsReport;
  problem: string | null;
  connection: SessionsConnection;
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
          {connection === "reconnecting" && (
            <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
          )}
          {connection !== "open" && CONNECTION_WORDS[connection]}
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
        <>
          <SessionChains chains={report.chains} />
          <Groups report={report} />
        </>
      )}
    </>
  );
}

/** The state filter's choices, in the order the bar offers them. */
const STATE_CHOICES = [
  [ALL_STATES, STATE_FILTER_ALL],
  ...Object.values(SESSION_STATE).map((state) => [state, state] as const),
] as const satisfies readonly (readonly [StateChoice, string])[];

function Groups({ report }: { report: SessionsReport }) {
  // A slice names its card by id; the facts are the card's, once per reading.
  const cards = useMemo(() => indexCards(report.sessions), [report.sessions]);
  const [choice, setChoice] = useState<StateChoice>(ALL_STATES);
  const groups = useMemo(
    () => filterGroups(report.groups, cards, choice),
    [report.groups, cards, choice],
  );
  return (
    <div className="space-y-4">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        value={choice}
        // Radix emits "" when the chosen item is pressed again; the filter
        // always has a choice, so that is ignored.
        onValueChange={(value) => {
          if (value) setChoice(value as StateChoice);
        }}
        aria-label={STATE_FILTER_LABEL}
        className="flex-wrap"
      >
        {STATE_CHOICES.map(([value, label]) => (
          <ToggleGroupItem key={value} value={value}>
            {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {/* Below the bar rather than in its place, so the filter can still be
          cleared (design-states.md). */}
      {groups.length === 0 ? (
        <p className="max-w-prose text-sm text-muted-foreground">
          {NO_SESSIONS_IN_STATE}
        </p>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <Group key={group.key} group={group} cards={cards} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Every card in `cards`, at any depth, by its id. */
function indexCards(
  cards: SessionCard[],
  into = new Map<string, SessionCard>(),
): Map<string, SessionCard> {
  for (const card of cards) {
    into.set(card.id, card);
    indexCards(card.children, into);
  }
  return into;
}

/** A group's heading and the line under it, by its kind. */
function groupWords(group: SessionGroup): { title: ReactNode; note?: string } {
  switch (group.kind) {
    case SESSION_GROUP_KIND.issue:
      return {
        title: (
          <a
            href={`${WELCOME_REPOSITORY.href}/issues/${group.issue}`}
            target="_blank"
            rel="noreferrer"
            className="text-link underline-offset-4 hover:underline"
          >
            {issueGroupTitle(group.issue)}
          </a>
        ),
      };
    case SESSION_GROUP_KIND.base:
      return { title: BASE_GROUP_TITLE, note: BASE_GROUP_NOTE };
    case SESSION_GROUP_KIND.other:
      return { title: OTHER_GROUP_TITLE, note: OTHER_GROUP_NOTE };
  }
}

function Group({
  group,
  cards,
}: {
  group: SessionGroup;
  cards: Map<string, SessionCard>;
}) {
  const headingId = useId();
  const { title, note } = groupWords(group);
  return (
    <section
      aria-labelledby={headingId}
      data-session-group={group.key}
      className="space-y-3"
    >
      <div className="space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id={headingId} className="text-base font-semibold">
            {title}
          </h2>
          <span
            data-session-group-total
            className="text-sm text-muted-foreground tabular-nums"
          >
            {outputTokens(group.out)}
          </span>
        </div>
        {note && (
          <p className="max-w-prose text-xs text-muted-foreground">{note}</p>
        )}
      </div>
      <ol className="space-y-3">
        {group.sessions.map((slice) => (
          <li key={slice.id}>
            {/* Each session skips its layout and paint while off screen. A
                fold otherwise laid out and pre-painted every card on the
                page: with this machine's 256 sessions, 1.3s of frozen page
                per press (#611). On the card rather than the `<li>`, whose
                paint containment would clip the card's ring. */}
            <Card
              size="sm"
              className="[contain-intrinsic-size:auto_15rem] [content-visibility:auto]"
            >
              <CardContent>
                <CardBody slice={slice} cards={cards} depth={0} />
              </CardContent>
            </Card>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** A card's heading level by its depth, the session's being `h3` under its
 *  group's `h2`, so the outline follows the tree. Past `h6` it stays there. */
const HEADINGS = ["h3", "h4", "h5", "h6"] as const;

/**
 * One card's facts and its share of the group, then the subagents under it,
 * recursively, which fold away under a control beside its task. Folded, the
 * figures stay: they are the card's and its subtree's whatever is shown.
 *
 * Only a session is a `Card`. Its subagents are an indented list inside it, a
 * rule down the left marking each level, rather than a card in a card in a
 * card (design.md): the nesting is the tree, and the rule already says what is
 * under what.
 */
function CardBody({
  slice,
  cards,
  depth,
}: {
  slice: SessionSlice;
  cards: Map<string, SessionCard>;
  depth: number;
}) {
  const headingId = useId();
  const [open, setOpen] = useState(true);
  const card = cards.get(slice.id);
  // Built from the same reading, so never missing; a reading that disagreed
  // with itself would cost the one card, not the page.
  if (!card) return null;
  const task = card.task ?? NO_TASK;
  const Heading = HEADINGS[Math.min(depth, HEADINGS.length - 1)];
  const hasChildren = slice.children.length > 0;
  const step = stepWords(card.step, depth);
  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <article
        aria-labelledby={headingId}
        data-session-card={card.id}
        className="space-y-2"
      >
        <div className="space-y-1">
          <div className="flex items-start gap-1">
            {hasChildren && (
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="-ml-1"
                  aria-label={toggleSubagentsLabel(open, task)}
                >
                  <ChevronRight
                    aria-hidden="true"
                    className={cn("transition-transform", open && "rotate-90")}
                  />
                </Button>
              </CollapsibleTrigger>
            )}
            <Heading
              id={headingId}
              className="text-sm font-medium text-balance break-words"
            >
              {task}
            </Heading>
          </div>
          {/* Ranked rows rather than one run of a dozen facts alike (#613):
              what a developer scans for first, state, time and spend, in the
              foreground; what the card is, quieter; then its tools, under a
              label of their own. */}
          <dl className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground">
            <Fact label="State">
              <Badge variant={STATE_BADGE[card.state]}>{card.state}</Badge>
            </Fact>
            <Fact label="Elapsed" numeric>
              {formatElapsed(card.elapsedMs)}
            </Fact>
            <Fact label="Own output" numeric>
              {outputTokens(slice.out)}
            </Fact>
            {hasChildren && (
              <Fact label="With subagents" numeric>
                {withSubagents(slice.subtreeOut)}
              </Fact>
            )}
          </dl>
          <dl className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <Fact label="Type">{card.subagentType ?? SESSION_KIND_LABEL}</Fact>
            <Fact label="Model">{card.model ?? NO_MODEL}</Fact>
            {step && <Fact label="Step">{step}</Fact>}
          </dl>
          <dl className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <dt className="shrink-0 font-medium">{TOOLS_LABEL}</dt>
            <dd data-session-fact="Tools" className="min-w-0">
              <Tools tools={card.tools} />
            </dd>
          </dl>
        </div>
        {hasChildren && (
          <CollapsibleContent asChild>
            <ol
              aria-label={subagentsLabel(task)}
              className="space-y-3 border-l border-border pl-4"
            >
              {slice.children.map((child) => (
                <li key={child.id}>
                  <CardBody slice={child} cards={cards} depth={depth + 1} />
                </li>
              ))}
            </ol>
          </CollapsibleContent>
        )}
      </article>
    </Collapsible>
  );
}

/**
 * A card's step in words, or null for none. Only a card running `implement`
 * has a step. R9 gives one to a worker, so a session whose calls match no
 * step's rules shows none rather than "Step unknown" (#613): a long session
 * that typed `/implement` once and went on to other work reads unknown for
 * the rest of its life. A subagent still says it.
 */
function stepWords(step: ImplementStep | null, depth: number): string | null {
  if (step === null) return null;
  if (step !== IMPLEMENT_STEP.unknown) return stepLabel(step);
  return depth === 0 ? null : STEP_UNKNOWN;
}

/**
 * The tools a card has called, each by Claude Code's own name and in `code`,
 * as a file name is: they are Claude Code's words, `Agent` among them, not
 * the page's (R12).
 */
function Tools({ tools }: { tools: ToolTally[] }) {
  if (tools.length === 0) return NO_TOOLS;
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {tools.map(({ name, calls }) => (
        <span key={name} data-session-tool={name} className="tabular-nums">
          <code className="font-mono">{name}</code>
          {toolCallCount(calls)}
        </span>
      ))}
    </span>
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
