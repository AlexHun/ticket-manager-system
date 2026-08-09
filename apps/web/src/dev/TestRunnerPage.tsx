import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Ban,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Database,
  ListChecks,
  Loader2,
  Play,
  Terminal,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { extractErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { useSuites } from "./dev-api";
import { CASE_STATUS, SUITE_KIND, type SuiteDescriptor } from "./protocol";
import {
  RUN_STATUS,
  runOf,
  useTestRunner,
  type LogLine,
  type RunStatus,
  type SuiteRun,
  type TestRunner,
} from "./use-test-run";

/**
 * Runs the repo's checks from the browser and shows them happening.
 *
 * The visible confirmation is deliberately three things at once, because each
 * answers a different question. A status word with an icon says *whether* it
 * passed. Per-file rows say *what* ran. And the reporter's own output, streamed
 * line by line, is the only one of the three that is evidence rather than a
 * summary — if the parsed counts and the log ever disagree, believe the log.
 *
 * Only the first of the three is always on screen. Each suite's body folds away,
 * so the page is three header lines at rest; what stays in the header is every
 * signal that moves while a run is going — status, elapsed, files done, failures
 * so far, lines received. Unfolded, the other two answers sit side by side
 * rather than stacked, because reading a failing row used to mean scrolling past
 * the log that explains it.
 */

function formatDuration(ms: number | null): string {
  if (ms === null) return "";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes}m ${Math.round((ms % 60_000) / 1000)}s`;
}

const STATUS_VISUAL: Record<
  RunStatus,
  { label: string; icon: typeof Play; className: string }
> = {
  [RUN_STATUS.idle]: {
    label: "Not run",
    icon: CircleDashed,
    className: "text-muted-foreground",
  },
  [RUN_STATUS.running]: {
    label: "Running",
    icon: Loader2,
    className: "text-foreground",
  },
  // Status colours are the only colours on this page that mean anything, and each
  // ships with its word and its icon — never the colour alone.
  [RUN_STATUS.passed]: {
    label: "Passed",
    icon: CheckCircle2,
    className: "text-status-good",
  },
  [RUN_STATUS.failed]: {
    label: "Failed",
    icon: XCircle,
    className: "text-status-critical",
  },
  [RUN_STATUS.cancelled]: {
    label: "Cancelled",
    icon: Ban,
    className: "text-status-warning",
  },
};

export function TestRunnerPage() {
  const { data: suites, isPending, error } = useSuites();
  const runner = useTestRunner();

  if (isPending) {
    return (
      <div className="flex flex-col gap-4 p-4" aria-busy="true">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (error || !suites) {
    return (
      <div className="p-4">
        <Card size="sm">
          <CardHeader>
            <CardTitle>Could not list the suites</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {extractErrorMessage(error, "The dev middleware returned an error.")}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    /* Block layout with `space-y`, deliberately not `flex flex-col gap-4`.
     *
     * As a flex column this page collapsed: shadcn's `Card` carries
     * `overflow-hidden`, which makes it a scroll container, and for a scroll
     * container `min-height: auto` resolves to *zero* rather than to its content
     * height. So flex-shrink was free to crush every card. The E2E card's spec
     * list overflowed the column, the two short cards above it were squashed to a
     * few pixels, and their own `overflow-hidden` clipped the contents — which
     * read as cards overlapping each other.
     *
     * A block container never shrinks its children, so each card keeps its
     * natural height and the page scrolls instead. `min-h-0 flex-1` stays: this
     * element is still a flex *item* of the dev shell's height chain. */
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
      <Controls suites={suites} runner={runner} />
      {suites.map((suite) => (
        <SuiteCard key={suite.id} suite={suite} runner={runner} />
      ))}
      <p className="text-xs text-muted-foreground">
        Each suite is the same command you would type in the terminal, run in the
        repo root by the Vite dev plugin — no test-specific server, and no
        environment of its own. The runs belong to the dev server, not to this tab:
        reloading or navigating away leaves them going and reconnects to whatever is
        in flight. Only Cancel stops one, and it kills the whole process tree —
        which for the E2E suite includes the two servers it started. Restarting
        `vite dev` also stops everything.
      </p>
    </div>
  );
}

function Controls({
  suites,
  runner,
}: {
  suites: SuiteDescriptor[];
  runner: TestRunner;
}) {
  const busy = runner.activeId !== null;
  // Named, not id'd: the banner is the one line a screen reader announces, and
  // "web-unit" is an internal handle.
  const running = suites.find((suite) => suite.id === runner.activeId);
  const finished = suites.filter((suite) => {
    const status = runOf(runner.runs, suite.id).status;
    return status === RUN_STATUS.passed || status === RUN_STATUS.failed;
  });
  const failed = finished.filter(
    (suite) => runOf(runner.runs, suite.id).status === RUN_STATUS.failed,
  );
  const planned = busy || runner.queued.length > 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Tests</h1>
          <p className="text-sm text-muted-foreground">
            {suites.length} suites. Run one, or run them all — fastest first, so a
            broken type fails before Playwright boots a browser.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">dev only</Badge>
          <Button
            onClick={() => runner.runAll(suites.map((suite) => suite.id))}
            disabled={planned}
          >
            <Play aria-hidden="true" />
            Run all tests
          </Button>
          <Button variant="outline" onClick={runner.cancel} disabled={!busy}>
            <Ban aria-hidden="true" />
            Cancel
          </Button>
        </div>
      </div>

      {/* The one-line answer, and the only live region on the page — the log is
          explicitly not announced, or a screen reader would read every line of
          Vitest output aloud. */}
      <div
        aria-live="polite"
        className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-card px-3 py-2 text-sm ring-1 ring-border"
      >
        {!runner.connected ? (
          <>
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            <span className="text-muted-foreground">
              Connecting to the dev server…
            </span>
          </>
        ) : planned ? (
          <>
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            <span>
              Running{" "}
              <span className="font-medium">{running?.label ?? "next suite"}</span>
              {runner.queued.length > 0 && ` · ${runner.queued.length} queued`}
            </span>
          </>
        ) : finished.length === 0 ? (
          <span className="text-muted-foreground">
            Nothing run yet in this session.
          </span>
        ) : failed.length === 0 ? (
          <>
            <CheckCircle2 aria-hidden="true" className="size-4 text-status-good" />
            <span>
              {finished.length} of {suites.length} suites run — all passed.
            </span>
          </>
        ) : (
          <>
            <XCircle aria-hidden="true" className="size-4 text-status-critical" />
            <span>
              {failed.length} of {finished.length} suites run failed:{" "}
              {failed.map((suite) => suite.label).join(", ")}.
            </span>
          </>
        )}
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {finished.length}/{suites.length} complete
        </span>
      </div>
      <Progress
        value={(finished.length / Math.max(1, suites.length)) * 100}
        aria-hidden="true"
      />

      {runner.problem && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {runner.problem}
        </p>
      )}
    </div>
  );
}

function SuiteCard({
  suite,
  runner,
}: {
  suite: SuiteDescriptor;
  runner: TestRunner;
}) {
  const run = runOf(runner.runs, suite.id);
  const queuePosition = runner.queued.indexOf(suite.id);
  const isRunning = runner.activeId === suite.id;
  const status = isRunning ? RUN_STATUS.running : run.status;
  const hasResults = isRunning || run.lines.length > 0 || run.cases.length > 0;

  // Folded by default. Each body is a spec list and a log — most of a screen
  // apiece, and three of them buried the run buttons below the fold. The header
  // keeps every signal that moves, so a folded card still reports its run.
  const [open, setOpen] = useState(false);

  // Unfold when this suite *starts*, or a run kicked off from a folded card
  // would stream into something nobody can see. Only the transition opens it, so
  // folding a card mid-run sticks.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (isRunning && !wasRunning.current) setOpen(true);
    wasRunning.current = isRunning;
  }, [isRunning]);

  return (
    /* The Collapsible wraps the Card rather than being it (`asChild`): Radix
     * stamps `data-slot="collapsible"` on whatever it renders, and on the Card
     * that would overwrite the `data-slot="card"` its own child selectors read. */
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <CollapsibleTrigger asChild>
              {/* Only the name is the trigger. Making the whole row one would put
                  Run and Clear inside a button, which is invalid and unclickable. */}
              <Button variant="ghost" size="sm" className="-ml-1.5 text-sm font-medium">
                <ChevronRight
                  aria-hidden="true"
                  className={cn("transition-transform", open && "rotate-90")}
                />
                {suite.label}
              </Button>
            </CollapsibleTrigger>
            <StatusBadge status={status} />
            {queuePosition >= 0 && !isRunning && (
              <Badge variant="secondary" className="font-normal">
                queued
              </Badge>
            )}

            <div className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-1.5">
              <RunStats run={run} live={isRunning} />
              <div className="flex items-center gap-2">
                {run.lines.length > 0 && !isRunning && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => runner.clear(suite.id)}
                  >
                    Clear
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => runner.run(suite.id)}
                  disabled={isRunning || queuePosition >= 0}
                >
                  {isRunning ? (
                    <Loader2 aria-hidden="true" className="animate-spin" />
                  ) : (
                    <Play aria-hidden="true" />
                  )}
                  Run
                </Button>
              </div>
            </div>
          </CardTitle>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">{suite.description}</p>

            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                {suite.command}
              </code>
              {suite.heavy && (
                <span className="flex items-center gap-1 text-xs text-status-warning">
                  <Database aria-hidden="true" className="size-3.5" />
                  needs Postgres — run{" "}
                  <code className="font-mono">bun run db:test:reset</code> once first
                </span>
              )}
            </div>

            {run.error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {run.error}
              </p>
            )}

            {hasResults && (
              /* Two columns from `lg` up, one below it. The list says what ran and
               * the log says why — read together, not one after the other, which
               * is what the stacked layout forced: a failing row and the output
               * explaining it were a screen apart. `items-start` so the short
               * panel keeps its own height instead of stretching to the tall one. */
              <div className="grid items-start gap-3 lg:grid-cols-2">
                <CaseList run={run} suite={suite} />
                <LogView lines={run.lines} dropped={run.dropped} live={isRunning} />
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

function StatusBadge({ status }: { status: RunStatus }) {
  const visual = STATUS_VISUAL[status];
  const Icon = visual.icon;
  return (
    <Badge variant="outline" className={cn("gap-1.5 font-normal", visual.className)}>
      <Icon
        aria-hidden="true"
        className={status === RUN_STATUS.running ? "animate-spin" : undefined}
      />
      {visual.label}
    </Badge>
  );
}

/**
 * How the run is going, on the card's own header line.
 *
 * It lives in the header because that is the part that survives folding: with
 * the body away, this is the only thing on screen that moves. While a suite runs
 * it reports what has actually arrived — elapsed, files finished, failures so
 * far, lines received — none of which wait on the reporter's summary, which for
 * the E2E suite is minutes away.
 *
 * Once the run ends it switches to the parsed numbers. Everything there is
 * nullable and rendered only when present, because three reporters count three
 * different things: Vitest reports files and tests, tsc reports diagnostics,
 * Playwright reports tests alone. A dash would imply zero.
 */
function RunStats({ run, live }: { run: SuiteRun; live: boolean }) {
  const chips: { label: string; value: ReactNode; tone?: string }[] = [];
  const { summary } = run;

  if (live) {
    chips.push({ label: "elapsed", value: <Elapsed since={run.startedAt} /> });
    if (run.cases.length > 0) {
      chips.push({ label: "done", value: run.cases.length });
      const failedSoFar = run.cases.filter(
        (result) => result.status === CASE_STATUS.failed,
      ).length;
      if (failedSoFar > 0) {
        chips.push({
          label: "failed",
          value: failedSoFar,
          tone: "text-status-critical",
        });
      }
    }
    // The last resort: a typecheck and a silent Vitest emit no cases at all, and
    // a line count that keeps climbing is then the only proof of life there is.
    chips.push({ label: "lines", value: run.lines.length });
  }

  if (summary?.files) {
    chips.push({
      label: "files",
      value: `${summary.files.passed}/${summary.files.total}`,
    });
  }
  if (summary?.tests) {
    chips.push({ label: "tests passed", value: summary.tests.passed });
    if (summary.tests.failed > 0) {
      chips.push({
        label: "failed",
        value: summary.tests.failed,
        tone: "text-status-critical",
      });
    }
    if (summary.tests.skipped > 0) {
      chips.push({ label: "skipped", value: summary.tests.skipped });
    }
  }
  if (summary?.errors !== null && summary?.errors !== undefined) {
    chips.push({
      label: summary.errors === 1 ? "type error" : "type errors",
      value: summary.errors,
      tone: summary.errors > 0 ? "text-status-critical" : "text-status-good",
    });
  }
  if (run.durationMs !== null) {
    chips.push({ label: "took", value: formatDuration(run.durationMs) });
  }
  if (run.exitCode !== null && run.exitCode !== 0) {
    chips.push({ label: "exit code", value: run.exitCode });
  }

  if (chips.length === 0) return null;

  return (
    <dl className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs font-normal">
      {chips.map((chip) => (
        <div key={chip.label} className="flex items-baseline gap-1">
          <dt className="text-muted-foreground">{chip.label}</dt>
          <dd className={cn("font-medium tabular-nums", chip.tone)}>{chip.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * One column of the split body.
 *
 * Shared rather than written twice, so the two columns agree on header height,
 * ring and scroll cap and read as a pair. The body scrolls inside the panel:
 * that cap is what keeps a 187-spec list from pushing the card below it off the
 * page, and it is why the two can sit side by side at all.
 */
function Panel({
  icon: Icon,
  title,
  meta,
  children,
}: {
  icon: typeof Terminal;
  title: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col rounded-md ring-1 ring-border">
      <h3 className="flex items-center gap-2 border-b border-border px-2.5 py-1.5 text-xs font-medium">
        <Icon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        {title}
        <span className="ml-auto flex items-center gap-2 font-normal text-muted-foreground tabular-nums">
          {meta}
        </span>
      </h3>
      {children}
    </section>
  );
}

function CaseList({ run, suite }: { run: SuiteRun; suite: SuiteDescriptor }) {
  const failures = run.cases.filter((result) => result.status === CASE_STATUS.failed);
  // Failures first: on a red run they are the only rows anyone reads, and a long
  // list of passes above them is in the way.
  const ordered = [
    ...failures,
    ...run.cases.filter((result) => result.status !== CASE_STATUS.failed),
  ];

  return (
    <Panel
      icon={ListChecks}
      title={suite.kind === SUITE_KIND.e2e ? "Specs" : "Test files"}
      meta={
        run.cases.length > 0 && (
          <>
            {failures.length > 0 && (
              <span className="text-status-critical">{failures.length} failed</span>
            )}
            <span>{run.cases.length}</span>
          </>
        )
      }
    >
      {ordered.length === 0 ? (
        /* Vitest off a TTY prints totals and nothing per file, so a green run
           legitimately has no rows. Said out loud, because an empty list beside a
           "Passed" badge otherwise looks like something failed to load. */
        <p className="px-2.5 py-2 text-xs text-muted-foreground">
          {suite.kind === SUITE_KIND.types
            ? "A typecheck reports diagnostics, not files — the count is in the header and anything it found is in the output."
            : run.summary?.tests
              ? "This reporter prints totals rather than a line per file when it is not writing to a terminal. The counts are in the header, the run itself is in the output."
              : "Nothing reported yet."}
        </p>
      ) : (
        <ul className="flex max-h-80 flex-col overflow-y-auto">
          {ordered.map((result, index) => (
            <li
              key={`${result.name}|${index}`}
              /* `relative` is load-bearing, not decoration. The status word below is
               * `sr-only`, which Tailwind implements as `position: absolute` — and an
               * absolutely-positioned box with no positioned ancestor is laid out
               * against the *document*, escaping this list's clipping entirely. With
               * 187 specs that put the last label 5962px down the page and gave the
               * document its own scrollbar alongside the one this list already has.
               * Making each row a containing block keeps the label where its row is. */
              className="relative flex items-center gap-2 border-b border-border/50 px-2.5 py-1 text-xs last:border-0"
            >
              {result.status === CASE_STATUS.passed ? (
                <CheckCircle2
                  aria-hidden="true"
                  className="size-3.5 shrink-0 text-status-good"
                />
              ) : result.status === CASE_STATUS.failed ? (
                <XCircle
                  aria-hidden="true"
                  className="size-3.5 shrink-0 text-status-critical"
                />
              ) : (
                <CircleDashed
                  aria-hidden="true"
                  className="size-3.5 shrink-0 text-muted-foreground"
                />
              )}
              <span className="sr-only">{result.status}: </span>
              <span className="truncate font-mono" title={result.name}>
                {result.name}
              </span>
              <span className="ml-auto flex shrink-0 items-center gap-3 text-muted-foreground tabular-nums">
                {result.tests !== null && <span>{result.tests} tests</span>}
                {result.durationMs !== null && (
                  <span>{formatDuration(result.durationMs)}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * A ticking clock, mounted only while a suite runs.
 *
 * It exists because Vitest off a TTY can print nothing for a minute and a half:
 * without something moving, a working run and a hung one look identical. Counting
 * up is the cheapest honest signal — no progress bar could be honest here, since
 * nothing tells us how far along it is.
 *
 * Measured from the server's start time, not from mount, so a page reloaded
 * mid-run keeps counting from where the run actually began.
 */
function Elapsed({ since }: { since: number | null }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (since === null) return <>…</>;

  return <>{formatDuration(Math.max(0, now - since))}</>;
}

/**
 * The reporter's own output.
 *
 * Sticks to the bottom while new lines arrive, but only while you are already
 * there — scroll up to read a failure and it stops fighting you. `role="log"`
 * with `aria-live="off"` on purpose: the region is labelled for navigation, and
 * announcing it would read hundreds of lines aloud.
 *
 * Folding the card takes this subtree out of the DOM entirely — Radix's
 * collapsible renders `isOpen && children`, not a hidden box — so the cap of
 * 3000 line elements costs nothing while folded, and unfolding remounts, which
 * runs the effect below and lands you back at the newest line.
 */
function LogView({
  lines,
  dropped,
  live,
}: {
  lines: LogLine[];
  dropped: number;
  live: boolean;
}) {
  const viewRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    const element = viewRef.current;
    if (!element || !stickRef.current) return;
    element.scrollTop = element.scrollHeight;
  }, [lines]);

  return (
    <Panel
      icon={Terminal}
      title="Output"
      meta={
        <>
          {live && <span>streaming…</span>}
          <span>
            {lines.length}
            {dropped > 0 && ` (+${dropped} dropped)`}
          </span>
        </>
      }
    >
      <div
        ref={viewRef}
        role="log"
        aria-live="off"
        aria-label="Test output"
        onScroll={(event) => {
          const element = event.currentTarget;
          stickRef.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < 24;
        }}
        className="max-h-80 overflow-auto p-2.5"
      >
        {dropped > 0 && (
          <p className="pb-1 text-xs text-muted-foreground">
            …{dropped} earlier lines dropped to keep this page responsive.
          </p>
        )}
        <ol className="flex flex-col font-mono text-xs leading-relaxed">
          {lines.map((line) => (
            <li
              key={line.id}
              className={cn(
                "border-l-2 pl-2 break-words whitespace-pre-wrap text-foreground/85",
                // stderr is marked, not reddened. It is not an error channel —
                // `bun run` echoes the command it is about to run there — and
                // painting that line destructive-red said something false about
                // every successful run.
                line.stream === "err"
                  ? "border-muted-foreground/50"
                  : "border-transparent",
              )}
            >
              {/* A blank line still needs a box, or the log collapses the
                  spacing the reporter deliberately printed. */}
              {line.text || " "}
            </li>
          ))}
        </ol>
      </div>
    </Panel>
  );
}
