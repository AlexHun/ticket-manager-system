import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "react-router-dom";
import { ArrowLeft, Mail } from "lucide-react";
import {
  AUTO_REPLY_DECLINE,
  type AutoReplyDecline,
  type TicketDetail,
  type TicketDetailResponse,
} from "@ticket/shared";
import { CategoryBadge, StatusBadge } from "@/components/TicketBadges";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { initialsOf } from "@/lib/initials";
import {
  extractErrorMessage,
  isClientError,
  isNotFoundError,
} from "@/lib/errors";
import { listPathFrom } from "@/lib/ticket-list-params";
import { ticketKeys } from "@/lib/ticket-queries";
import { useDocumentTitle } from "@/lib/use-document-title";
import { cn } from "@/lib/utils";
import {
  ASSIGNEE_SELECT_ID,
  TicketAssigneeSelect,
} from "./TicketAssigneeSelect";
import {
  CATEGORY_SELECT_ID,
  STATUS_SELECT_ID,
  TicketCategorySelect,
  TicketStatusSelect,
} from "./TicketFieldSelects";
import { TicketMessageThread } from "./TicketMessageThread";
import { TicketReplyComposer } from "./TicketReplyComposer";
import { TicketSummaryPanel } from "./TicketSummaryPanel";

function useTicketQuery(id: string | undefined) {
  return useQuery({
    // Shares the "tickets" prefix with the list key so one invalidate can reach
    // both; "detail" keeps it from ever colliding with the list's params object.
    queryKey: ticketKeys.detail(id ?? ""),
    queryFn: async ({ signal }) => {
      const { data } = await api.get<TicketDetailResponse>(
        `/api/tickets/${id}`,
        { signal },
      );
      return data.ticket;
    },
    // A rejected request is an answer, not a flake: a bad id will still be bad
    // three retries later, and the backoff only delays the screen that explains
    // it. Genuine transient failures (network, 5xx) still get the default.
    retry: (failureCount, error) => !isClientError(error) && failureCount < 3,
  });
}

export function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const backTo = listPathFrom(location.state);

  const { data: ticket, isPending, error } = useTicketQuery(id);

  // Overrides the section name `AppShell` sets, once there is a subject to use.
  // This is the route where it matters most: three tickets open in three tabs
  // are otherwise three tabs called "Tickets", and the ticket number is what
  // someone is switching between them to find.
  useDocumentTitle(ticket ? `#${ticket.id} ${ticket.subject}` : null);

  return (
    // Splits the frame from `lg` up, like the list page: the details and the
    // thread each scroll on their own, so the fields an agent is changing stay
    // put while they read. Below that the two panes stack and this whole
    // element scrolls instead — splitting a short viewport in two would leave a
    // message pane too small to read in.
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6 lg:overflow-hidden">
      {/* Outside the loaded branch: the not-found screen is a dead end
          without it. */}
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-4 self-start">
        <Link to={backTo}>
          <ArrowLeft aria-hidden="true" />
          Back to tickets
        </Link>
      </Button>

      {isPending && <TicketDetailSkeleton />}

      {/* A ticket that isn't there is a destination, not a failure — no
          role="alert", because nothing went wrong for AT to interrupt over. */}
      {isNotFoundError(error) && (
        <div>
          <h1 className="mb-2 text-2xl font-semibold">Ticket not found</h1>
          <p className="text-sm text-muted-foreground">
            This ticket may have been deleted, or the link may be wrong.
          </p>
        </div>
      )}

      {error && !isNotFoundError(error) && (
        <p className="text-sm text-destructive" role="alert">
          {extractErrorMessage(error, "Failed to load ticket")}
        </p>
      )}

      {ticket && <TicketDetailView ticket={ticket} />}
    </div>
  );
}

function TicketDetailView({ ticket }: { ticket: TicketDetail }) {
  return (
    <div className="flex flex-1 flex-col gap-6 lg:min-h-0">
      {/* A band across both panes rather than a column heading: a long subject
          gets the whole width here instead of wrapping four times in a 22rem
          sidebar.

          Badges here, pickers in the card: the two say the same thing on
          purpose. Colour is what makes the state readable at a glance, and a
          select trigger can't carry it without looking unlike every other
          control on the page — so the badge shows, and the picker changes. */}
      <div className="shrink-0">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <StatusBadge status={ticket.status} />
          {ticket.category && <CategoryBadge category={ticket.category} />}
          <span className="text-sm text-muted-foreground">#{ticket.id}</span>
        </div>
        <h1 className="text-2xl font-semibold break-words">{ticket.subject}</h1>
      </div>

      <div className="flex flex-1 flex-col gap-6 lg:min-h-0 lg:flex-row lg:gap-8">
        {/* Scrolls on its own so a short viewport can't clip the fields off
            the bottom of the card — which is also what makes it the right home
            for the summary panel below, whose height depends on what the model
            comes back with. */}
        <aside className="flex flex-col gap-6 lg:w-[22rem] lg:min-h-0 lg:shrink-0 lg:overflow-y-auto xl:w-[26rem]">
          {/* shrink-0 on both cards, and it is load-bearing rather than tidy.
              A flex column shrinks its children by default, so with two cards in
              here the browser squeezes each one to fit the available height
              instead of letting the column scroll — and a Card clips what no
              longer fits without reporting any overflow, so `aside.scrollHeight`
              comes back equal to its height and the scrollbar never appears.
              The bottom of the summary simply vanishes. Keeping both at their
              natural height is what hands the overflow to the scroll container
              that is meant to have it. */}
          <Card className="shrink-0">
            <CardContent className="flex flex-col gap-5">
              {/* The customer is lifted out of the field grid entirely. As one
                  more `<dt>/<dd>` pair the address was a line of small grey
                  text among four of them — the hardest thing on the card to
                  find, and the one an agent came for. Here it is the card's
                  heading, and a mailto link besides, so it reads as something
                  to act on. */}
              <div className="flex items-center gap-3">
                <Avatar size="lg">
                  <AvatarFallback>
                    {initialsOf(ticket.customerName)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="font-medium">{ticket.customerName}</p>
                  <a
                    href={`mailto:${ticket.customerEmail}`}
                    className="inline-flex items-center gap-1.5 text-sm break-all text-primary underline-offset-4 hover:underline"
                  >
                    <Mail aria-hidden="true" className="size-3.5 shrink-0" />
                    {ticket.customerEmail}
                  </a>
                </div>
              </div>

              <Separator />

              {/* Wraps as a row while the card is full-width, and stacks once
                  it is a sidebar — five items of very different widths would
                  otherwise break into ragged rows in a 22rem column. */}
              <dl className="flex flex-wrap gap-x-10 gap-y-4 lg:flex-col lg:flex-nowrap lg:gap-y-5">
                <Field label="Status" htmlFor={STATUS_SELECT_ID}>
                  <TicketStatusSelect ticket={ticket} />
                </Field>
                <Field label="Category" htmlFor={CATEGORY_SELECT_ID}>
                  <TicketCategorySelect ticket={ticket} />
                </Field>
                <Field label="Assigned to" htmlFor={ASSIGNEE_SELECT_ID}>
                  <TicketAssigneeSelect ticket={ticket} />
                </Field>
                <Field label="Created">
                  <DateValue value={ticket.createdAt} />
                </Field>
                <Field label="Last message">
                  <DateValue value={ticket.lastMessageAt} />
                </Field>
                {ticket.autoReplyDecline && (
                  <Field label="Auto-reply">
                    <AutoReplyDeclineValue
                      decline={ticket.autoReplyDecline}
                      at={ticket.autoReplyDeclinedAt}
                    />
                  </Field>
                )}
              </dl>
            </CardContent>
          </Card>

          {/* Keyed on the ticket, because this component holds a generated
              summary in local state and React would otherwise reuse the
              instance across a navigation — leaving ticket 41's summary sitting
              under ticket 42's subject. The key is what makes "every click is a
              fresh generation" true across routes as well as clicks. */}
          <TicketSummaryPanel
            key={ticket.id}
            ticketId={ticket.id}
            messageCount={ticket.messages.length}
          />
        </aside>

        <section className="flex flex-col lg:min-h-0 lg:flex-1">
          <h2 className="mb-3 shrink-0 text-lg font-semibold">
            Messages ({ticket.messages.length})
          </h2>
          {/* The thread does its own scrolling; this only gives it the height
              left over. min-h-0 is load-bearing — without it a flex item won't
              shrink below its content, and the pane would push the page taller
              instead of scrolling inside. */}
          <TicketMessageThread
            className="lg:min-h-0 lg:flex-1"
            messages={ticket.messages}
          />
          {/* A sibling of the thread, never a child: the thread's `<ol>` *is*
              the scroll container, so a composer inside it would scroll away
              with the history. Out here it is the column's fixed footer. */}
          <TicketReplyComposer ticketId={ticket.id} />
        </section>
      </div>
    </div>
  );
}

const FIELD_LABEL_CLASS = "text-xs font-medium text-muted-foreground";

/**
 * `htmlFor` turns the term into a real `<label>` for the control in the
 * definition beside it — clicking "Assigned to" then opens the picker, and
 * assistive tech reads the two as one field rather than as loose text.
 */
function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="mb-1">
        {htmlFor ? (
          <Label htmlFor={htmlFor} className={FIELD_LABEL_CLASS}>
            {label}
          </Label>
        ) : (
          <span className={FIELD_LABEL_CLASS}>{label}</span>
        )}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Full date and time, unlike the list's date-only cells — on one ticket, when
 *  during the day something arrived is part of the story. */
function DateValue({ value }: { value: string }) {
  return <time dateTime={value}>{new Date(value).toLocaleString()}</time>;
}

/**
 * What the auto-reply concluded, in words rather than in a key.
 *
 * The wording separates two things an agent must not confuse. Three of these
 * mean *it never wrote anything* — the ticket was ineligible, already answered,
 * or unreadable. Four mean *it wrote a reply and the safety checks destroyed
 * it*, which is a different event entirely and is what an injection attempt
 * looks like from the outside. And one means the assistant was simply
 * unreachable, which is no verdict on the ticket at all.
 *
 * None of it is an error state. Declining is the designed, common outcome, so
 * this is drawn as another field in the card and not as a warning — the ticket
 * is `Open` and waiting, which is exactly what should happen.
 */
const DECLINE_LABEL: Record<AutoReplyDecline, string> = {
  [AUTO_REPLY_DECLINE.category]: "Not eligible — refunds and unfiled tickets are never auto-answered",
  [AUTO_REPLY_DECLINE.answered]: "Already answered — only opening messages are auto-answered",
  [AUTO_REPLY_DECLINE.noText]: "Nothing to read — the email carried no plain text",
  [AUTO_REPLY_DECLINE.notCovered]: "Not covered by the knowledge base",
  [AUTO_REPLY_DECLINE.noCitation]: "Draft discarded — it cited no article that exists",
  [AUTO_REPLY_DECLINE.unbackedCommitment]: "Draft discarded — it promised something no cited article states",
  [AUTO_REPLY_DECLINE.unbackedReference]: "Draft discarded — it carried a link or address no cited article contains",
  [AUTO_REPLY_DECLINE.tooLong]: "Draft discarded — too long to be a knowledge-base answer",
  [AUTO_REPLY_DECLINE.unavailable]: "The assistant could not be reached",
};

function AutoReplyDeclineValue({
  decline,
  at,
}: {
  decline: AutoReplyDecline;
  at: string | null;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span>{DECLINE_LABEL[decline]}</span>
      {at && (
        <time dateTime={at} className="text-xs text-muted-foreground">
          {new Date(at).toLocaleString()}
        </time>
      )}
    </div>
  );
}

function TicketDetailSkeleton() {
  return (
    // Mirrors the loaded layout — band, then the two panes — so nothing jumps
    // sideways the moment the ticket arrives.
    <div
      className="flex flex-1 flex-col gap-6 lg:min-h-0"
      aria-busy="true"
      aria-label="Loading ticket"
    >
      <div className="shrink-0">
        <Skeleton className="mb-2 h-5 w-40 rounded-md" />
        <Skeleton className="h-8 w-3/4 max-w-xl" />
      </div>

      <div className="flex flex-1 flex-col gap-6 lg:min-h-0 lg:flex-row lg:gap-8">
        <aside className="lg:w-[22rem] lg:shrink-0 xl:w-[26rem]">
          <Card>
            <CardContent className="flex flex-col gap-5">
              <div className="flex items-center gap-3">
                <Skeleton className="size-10 rounded-full" />
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-48" />
                </div>
              </div>
              <Separator />
              <div className="flex flex-wrap gap-x-10 gap-y-4 lg:flex-col lg:flex-nowrap lg:gap-y-5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="lg:w-full">
                    <Skeleton className="mb-2 h-3 w-20" />
                    <Skeleton className="h-4 w-40 lg:w-full" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </aside>

        <div className="flex flex-col lg:min-h-0 lg:flex-1">
          <Skeleton className="mb-3 h-6 w-36 shrink-0" />
          {/* Placeholders alternate sides, so the thread doesn't jump across
              the column the moment it loads. */}
          <div className="flex flex-col gap-5 lg:min-h-0 lg:flex-1">
            {[false, true, false].map((outbound, i) => (
              <div
                key={i}
                className={cn("flex gap-2", outbound && "flex-row-reverse")}
              >
                <Skeleton className="size-8 shrink-0 rounded-full" />
                <div
                  className={cn(
                    "flex w-2/3 max-w-[42rem] flex-col gap-1.5",
                    outbound && "items-end",
                  )}
                >
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-16 w-full rounded-2xl" />
                </div>
              </div>
            ))}
          </div>
          {/* The composer's footprint, so the column doesn't shuffle upward the
              moment the ticket lands. */}
          <Skeleton className="mt-4 h-28 w-full shrink-0 rounded-lg" />
        </div>
      </div>
    </div>
  );
}
