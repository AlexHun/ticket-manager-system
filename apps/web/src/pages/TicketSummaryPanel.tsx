import { useMutation } from "@tanstack/react-query";
import { RotateCw, Sparkles } from "lucide-react";
import type { SummarizeTicketValues } from "@ticket/core";
import {
  SUMMARY_SENTIMENT,
  type SummarizeTicketResponse,
  type SummarySentiment,
} from "@ticket/shared";
import { AiShine } from "@/components/AiShine";
import { Hint } from "@/components/Hint";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import { extractErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

/** The sparkles icon, breathing while the model works. */
function sparkleClass(pending: boolean): string {
  return cn("size-4 text-primary", pending && "animate-ai-glow");
}

const SUMMARY_FAILED = "Failed to summarise this ticket";

/**
 * How the customer is coming across, at a glance.
 *
 * Same construction as `CATEGORY_BADGE`: an explicit hue per value at a matched
 * lightness, with `dark:` text so each stays legible on both themes. The ramp is
 * ordered here rather than arbitrary — green, grey, amber, red is the
 * temperature this reads as, and it is the one thing on the panel an agent takes
 * in before reading a word.
 *
 * `neutral` deliberately gets no colour at all. Colouring it would put four
 * competing tints on a card whose job is to be scanned, and the state worth
 * noticing is any of the other three.
 */
const SENTIMENT_BADGE: Record<SummarySentiment, string> = {
  [SUMMARY_SENTIMENT.positive]:
    "border-transparent bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  [SUMMARY_SENTIMENT.neutral]: "border-transparent bg-muted text-foreground/70",
  // amber-700 measures 4.5:1 on the light tint — one step darker to clear AA,
  // exactly as the Refund category badge does.
  [SUMMARY_SENTIMENT.frustrated]:
    "border-transparent bg-amber-500/15 text-amber-800 dark:text-amber-300",
  [SUMMARY_SENTIMENT.angry]:
    "border-transparent bg-rose-500/12 text-rose-700 dark:text-rose-300",
};

/** What the badge says. The wire values are lower case; these are for reading. */
const SENTIMENT_LABEL: Record<SummarySentiment, string> = {
  [SUMMARY_SENTIMENT.positive]: "Positive",
  [SUMMARY_SENTIMENT.neutral]: "Neutral",
  [SUMMARY_SENTIMENT.frustrated]: "Frustrated",
  [SUMMARY_SENTIMENT.angry]: "Angry",
};

/**
 * An AI summary of the ticket and its thread, generated on demand.
 *
 * Every click is a fresh generation, which is why this is a `useMutation` and
 * not a `useQuery`. That is not a shortcut around caching — it is the feature.
 * A query would hand back the summary it took last time, and a summary's whole
 * value is that it describes the conversation *now*; a cached one is a
 * confident paragraph about a ticket that has since been answered. Nothing is
 * stored on the server either, so there is no version of this that is cheap to
 * re-read and stale to trust.
 *
 * The panel keeps its own copy of the result only for as long as it is mounted,
 * and the call site gives it a `key` of the ticket id so navigating to another
 * ticket starts it empty rather than showing the previous ticket's summary under
 * a new subject.
 *
 * `messageCount` is the thread length as the page currently knows it. Comparing
 * it against the count the summary was built from is what lets the panel admit
 * it has been overtaken when a reply lands — see `stale` below.
 */
export function TicketSummaryPanel({
  ticketId,
  messageCount,
}: {
  ticketId: number;
  messageCount: number;
}) {
  const summarize = useMutation({
    mutationFn: async () => {
      // Typed as the schema's own inferred shape, so a field the server starts
      // requiring fails to compile here rather than at runtime. The ticket id is
      // the only thing that travels: the server reads the subject, the customer
      // and every message out of the thread itself.
      const payload: SummarizeTicketValues = { ticketId };
      const { data } = await api.post<SummarizeTicketResponse>(
        "/api/ai/summarize-ticket",
        payload,
      );
      return data;
    },
    // No success toast, unlike the composer's polish. That one fires because a
    // rewritten textarea is easy to miss; here the panel visibly fills with the
    // thing that was asked for, and a toast saying so would be the same news
    // twice.
    onError: (err) => {
      toast.error(extractErrorMessage(err, SUMMARY_FAILED));
    },
  });

  const result = summarize.data;

  return (
    // shrink-0 for the reason spelled out at the call site: this card sits in a
    // flex column that would otherwise squash it and silently clip the summary.
    // `relative` is what the shine ring below positions against.
    <Card data-tutorial-anchor="summary" className="relative shrink-0">
      <AiShine active={summarize.isPending} />
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <Sparkles
              aria-hidden="true"
              className={sparkleClass(summarize.isPending)}
            />
            AI summary
          </h2>

          {/* The span keeps the tooltip alive while the button is disabled:
              `buttonVariants` sets `disabled:pointer-events-none`, so a disabled
              Button never fires the hover a Radix TooltipTrigger listens for.
              Same wrapper, same reason, as Polish in the composer. */}
          <Hint
            content={
              summarize.isPending
                ? "Reading the ticket and its conversation…"
                : result
                  ? "Read the thread again and write a new summary"
                  : "Summarise this ticket and its conversation history"
            }
          >
            <span className="inline-flex">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="relative"
                onClick={() => summarize.mutate()}
                disabled={summarize.isPending}
              >
                <AiShine active={summarize.isPending} />
                {result ? (
                  <RotateCw
                    aria-hidden="true"
                    className={cn("size-4", summarize.isPending && "animate-spin")}
                  />
                ) : (
                  <Sparkles
                    aria-hidden="true"
                    className={sparkleClass(summarize.isPending)}
                  />
                )}
                {summarize.isPending
                  ? "Summarising…"
                  : result
                    ? "Regenerate"
                    : "Summarise"}
              </Button>
            </span>
          </Hint>
        </div>

        {summarize.isPending && <SummarySkeleton />}

        {!summarize.isPending && summarize.error && (
          <p className="text-sm text-destructive" role="alert">
            {extractErrorMessage(summarize.error, SUMMARY_FAILED)}
          </p>
        )}

        {/* Idle, and never generated: say what the button will do rather than
            leaving a header over nothing. */}
        {!summarize.isPending && !summarize.error && !result && (
          <p className="text-sm text-muted-foreground">
            Generate a fresh read of this ticket and its conversation history.
          </p>
        )}

        {!summarize.isPending && result && (
          // Keyed on the generation so a regenerate re-runs the entrance
          // animation: without it React reuses the node, the text swaps in
          // place, and a click that produced a near-identical summary looks
          // like a click that did nothing.
          <SummaryBody
            key={summarize.submittedAt}
            result={result}
            threadLength={messageCount}
          />
        )}
      </CardContent>
    </Card>
  );
}

/**
 * One generated summary, laid out.
 *
 * Its own component rather than a block inside the panel, because the panel
 * holds the result as `data | undefined` and every field below needs it
 * narrowed. Passing it as a prop does that once, at the boundary, instead of at
 * each of the six places that read it.
 */
function SummaryBody({
  result,
  threadLength,
}: {
  result: SummarizeTicketResponse;
  /** How long the thread is *now*, which is not always what this was built from. */
  threadLength: number;
}) {
  const { summary } = result;

  /**
   * The thread has moved on since this summary was made.
   *
   * Said out loud rather than quietly regenerated: an agent who has just sent a
   * reply does not need a paid call fired behind their back, and one who is
   * reading a summary should be told when it stopped being current rather than
   * have it change under them mid-sentence.
   */
  const stale = result.messageCount !== threadLength;

  // Built once per summary rather than per line: one pattern serves the
  // overview, every bullet and the next step, and rebuilding it eight times
  // would also mean eight chances to forget to reset `lastIndex`.
  const pattern = highlightPattern(summary.highlights);

  return (
    <div className="flex animate-panel-in flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={SENTIMENT_BADGE[summary.sentiment]}>
          {SENTIMENT_LABEL[summary.sentiment]}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {result.messageCount === 1
            ? "from 1 message"
            : `from ${result.messageCount} messages`}
        </span>
      </div>

      <p className="text-sm leading-relaxed">
        <Marked text={summary.overview} pattern={pattern} />
      </p>

      {summary.keyPoints.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <SectionLabel>Key points</SectionLabel>
          <ul className="flex list-disc flex-col gap-1.5 pl-4 text-sm leading-relaxed marker:text-muted-foreground">
            {summary.keyPoints.map((point) => (
              <li key={point}>
                <Marked text={point} pattern={pattern} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary.nextStep && (
        <div className="flex flex-col gap-1.5">
          <SectionLabel>Suggested next step</SectionLabel>
          <p className="text-sm leading-relaxed">
            <Marked text={summary.nextStep} pattern={pattern} />
          </p>
        </div>
      )}

      {stale && (
        // status rather than alert: nothing has gone wrong, and this should not
        // interrupt someone mid-sentence.
        <p className="text-xs text-muted-foreground" role="status">
          The thread has moved on since this summary. Regenerate to catch up.
        </p>
      )}

      {/* The disclaimer earns its line. This text is generated from messages
          strangers wrote, it is the one place in the app that restates them in
          the product's own voice, and an agent who acts on it without checking
          is exactly the failure the server-side prompt is built to make
          unlikely rather than impossible. */}
      <p className="text-xs text-muted-foreground">
        Written by AI from the messages in this thread. Check anything you act
        on.
      </p>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-medium text-muted-foreground">{children}</p>
  );
}

/** Characters that would otherwise be read as syntax in the pattern below. */
const REGEXP_SPECIAL = /[.*+?^${}()|[\]\\]/g;

/**
 * One pattern matching any of the phrases worth marking, or null for none.
 *
 * Escaped, because these strings are model output derived from email a stranger
 * wrote: an unescaped `(` is a syntax error that takes the panel down with it,
 * and `(a+)+$` is a pattern that hangs the tab. Escaping makes every term a
 * literal, which is also exactly what it is meant to be.
 *
 * Longest first, so "label created" wins over "label" and the shorter term never
 * eats the front of the longer one. `i` because the server matched
 * case-insensitively when it checked these occur at all, so the two have to
 * agree; `g` because `split` needs it to find more than the first.
 *
 * The group is capturing on purpose: `String.split` with a capturing pattern
 * interleaves the separators into the result, which is what puts the matched
 * text at every odd index below.
 */
function highlightPattern(terms: string[]): RegExp | null {
  if (terms.length === 0) return null;

  const alternatives = [...terms]
    .sort((a, b) => b.length - a.length)
    .map((term) => term.replace(REGEXP_SPECIAL, "\\$&"));

  return new RegExp(`(${alternatives.join("|")})`, "gi");
}

/**
 * A line of summary prose with its key words marked.
 *
 * `<mark>` rather than a styled `<span>`: this is exactly what the element is
 * for, and it is what carries the emphasis to a screen reader and into the
 * browser's own find-in-page. The styling is explicit because the CSS reset
 * strips the default yellow, which would be unreadable on the dark theme
 * anyway.
 *
 * Everything renders as React text nodes. There is no `dangerouslySetInnerHTML`
 * here and there must never be: these strings trace back to a stranger's email
 * through the model, so the "never render email HTML" rule reaches this far.
 */
function Marked({ text, pattern }: { text: string; pattern: RegExp | null }) {
  if (!pattern) return <>{text}</>;

  // `lastIndex` survives between calls on a `g` pattern and would make the
  // second line skip its first match. `split` resets it, but only because it is
  // documented to — being explicit is cheaper than relying on that.
  pattern.lastIndex = 0;
  const parts = text.split(pattern);

  return (
    <>
      {parts.map((part, index) =>
        // Odd indices are the captured separators, i.e. the matches themselves.
        index % 2 === 1 ? (
          <mark
            key={`${index}-${part}`}
            className="rounded-sm bg-primary/15 px-0.5 font-medium text-foreground"
          >
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

/**
 * The waiting state: placeholder lines, shaped like the answer.
 *
 * A wide line, a short one, a run of bullets — so the panel does not resize
 * under the reader when the real text lands. The motion that says work is
 * happening is not here at all any more: it is `AiShine` tracing the card's
 * border. These only need to hold the shape, which is what `Skeleton`'s own
 * pulse already does, so the two cues stay clearly one signal rather than
 * competing for the same job.
 *
 * `aria-hidden` on the boxes, with the live region below carrying the news.
 * There is nothing here to read out, and a screen reader announcing six empty
 * rectangles is worse than silence.
 */
function SummarySkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2.5" aria-hidden="true">
        <Skeleton className="h-3 w-20 rounded-full" />
        <Skeleton className="h-3 w-full rounded-full" />
        <Skeleton className="h-3 w-11/12 rounded-full" />
        <Skeleton className="h-3 w-2/3 rounded-full" />
        <Skeleton className="mt-2 h-3 w-5/6 rounded-full" />
        <Skeleton className="h-3 w-3/4 rounded-full" />
      </div>

      {/* The accessible half of the waiting state, and the half that survives a
          reduced-motion setting switching every animation off. `polite` so it is
          announced at a pause rather than cutting across whatever is being
          read. */}
      <p className="sr-only" role="status" aria-live="polite">
        Summarising this ticket and its conversation history.
      </p>
    </div>
  );
}
