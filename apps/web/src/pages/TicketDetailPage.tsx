import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import type { TicketDetail, TicketDetailResponse } from "@ticket/shared";
import { NavBar } from "@/components/NavBar";
import { CategoryBadge, StatusBadge } from "@/components/TicketBadges";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import {
  extractErrorMessage,
  isClientError,
  isNotFoundError,
} from "@/lib/errors";
import { listPathFrom } from "@/lib/ticket-list-params";
import { TicketMessageThread } from "./TicketMessageThread";

function useTicketQuery(id: string | undefined) {
  return useQuery({
    // Shares the "tickets" prefix with the list key so a future update can
    // invalidate both at once; "detail" keeps it from ever colliding with the
    // list's params object.
    queryKey: ["tickets", "detail", id],
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
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Field label="Customer">
              <span className="block">{ticket.customerName}</span>
              <span className="block text-xs text-muted-foreground">
                {ticket.customerEmail}
              </span>
            </Field>
            <Field label="Assigned to">
              {ticket.assignedTo ? (
                <>
                  <span className="block">{ticket.assignedTo.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {ticket.assignedTo.email}
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">Unassigned</span>
              )}
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

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="mb-1 text-xs font-medium text-muted-foreground">
        {label}
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
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i}>
                <Skeleton className="mb-2 h-3 w-20" />
                <Skeleton className="h-4 w-40" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <div className="flex flex-col gap-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-xl px-4 py-3 ring-1 ring-border">
            <Skeleton className="mb-3 h-4 w-48" />
            <Skeleton className="mb-2 h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}
