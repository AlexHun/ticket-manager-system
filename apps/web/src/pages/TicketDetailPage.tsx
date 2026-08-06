import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "react-router-dom";
import { ArrowLeft, Mail } from "lucide-react";
import type { TicketDetail, TicketDetailResponse } from "@ticket/shared";
import { NavBar } from "@/components/NavBar";
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
import { cn } from "@/lib/utils";
import {
  ASSIGNEE_SELECT_ID,
  TicketAssigneeSelect,
} from "./TicketAssigneeSelect";
import { TicketMessageThread } from "./TicketMessageThread";

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

  return (
    // Not viewport-owning, unlike the list: a long thread should scroll the
    // window, and max-w keeps the message text at a readable measure.
    <div className="min-h-screen bg-background">
      <NavBar />
      <main className="mx-auto w-full max-w-3xl p-6">
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-4">
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
      </main>
    </div>
  );
}

function TicketDetailView({ ticket }: { ticket: TicketDetail }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <StatusBadge status={ticket.status} />
          {ticket.category && <CategoryBadge category={ticket.category} />}
          <span className="text-sm text-muted-foreground">#{ticket.id}</span>
        </div>
        <h1 className="text-2xl font-semibold break-words">{ticket.subject}</h1>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-5">
          {/* The customer is lifted out of the field grid entirely. As one more
              `<dt>/<dd>` pair the address was a line of small grey text among
              four of them — the hardest thing on the card to find, and the one
              an agent came for. Here it is the card's heading, and a mailto
              link besides, so it reads as something to act on. */}
          <div className="flex items-center gap-3">
            <Avatar size="lg">
              <AvatarFallback>{initialsOf(ticket.customerName)}</AvatarFallback>
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

          {/* Wrapping rather than a fixed grid: three items of very different
              widths (a 224px picker and two dates) leave a column layout mostly
              empty, and these sit on one line at this width. */}
          <dl className="flex flex-wrap gap-x-10 gap-y-4">
            <Field label="Assigned to" htmlFor={ASSIGNEE_SELECT_ID}>
              <TicketAssigneeSelect ticket={ticket} />
            </Field>
            <Field label="Created">
              <DateValue value={ticket.createdAt} />
            </Field>
            <Field label="Last message">
              <DateValue value={ticket.lastMessageAt} />
            </Field>
          </dl>
        </CardContent>
      </Card>

      <section>
        <h2 className="mb-3 text-lg font-semibold">
          Messages ({ticket.messages.length})
        </h2>
        <TicketMessageThread messages={ticket.messages} />
      </section>
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

function TicketDetailSkeleton() {
  return (
    <div
      className="flex flex-col gap-6"
      aria-busy="true"
      aria-label="Loading ticket"
    >
      <div>
        <Skeleton className="mb-2 h-5 w-40 rounded-md" />
        <Skeleton className="h-8 w-3/4" />
      </div>
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
          <div className="flex flex-wrap gap-x-10 gap-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i}>
                <Skeleton className="mb-2 h-3 w-20" />
                <Skeleton className="h-4 w-40" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      {/* Placeholders alternate sides, so the thread doesn't jump across the
          column the moment it loads. */}
      <div className="flex flex-col gap-5">
        {[false, true].map((outbound, i) => (
          <div
            key={i}
            className={cn("flex gap-2", outbound && "flex-row-reverse")}
          >
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div
              className={cn(
                "flex w-2/3 flex-col gap-1.5",
                outbound && "items-end",
              )}
            >
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-16 w-full rounded-2xl" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
