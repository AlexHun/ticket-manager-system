import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Inbox, Loader2, RotateCw } from "lucide-react";
import {
  OUTBOUND_EMAIL_STATUS,
  type OutboundEmailKind,
  type OutboundEmailRow,
  type OutboundEmailStatus,
  type OutboxListResponse,
} from "@ticket/shared";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Every email this desk meant to send.
 *
 * **Not a debug view.** While no mail provider is configured, this page is the
 * delivery mechanism: a new colleague's invitation link exists nowhere else, and
 * an admin reading it off this screen is how they get into the app. That is the
 * arrangement that lets the user form have no password field.
 */

/** Radix reserves the empty string on a `SelectItem`, so "any" needs a token. */
const ANY_STATUS = "any";

const STATUS_LABEL: Record<OutboundEmailStatus, string> = {
  queued: "Queued",
  sent: "Sent",
  failed: "Failed",
  undeliverable: "Not sent",
};

const KIND_LABEL: Record<OutboundEmailKind, string> = {
  reply: "Ticket reply",
  passwordReset: "Password reset",
  invitation: "Invitation",
};

type OutboxResponse = OutboxListResponse & { mailConfigured: boolean };

export function OutboxPage() {
  const [status, setStatus] = useState<OutboundEmailStatus | typeof ANY_STATUS>(
    ANY_STATUS,
  );

  const { data, isPending, error } = useQuery({
    queryKey: ["outbox", status],
    queryFn: async ({ signal }) => {
      const { data } = await api.get<OutboxResponse>("/api/outbox", {
        signal,
        params: status === ANY_STATUS ? {} : { status },
      });
      return data;
    },
  });

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="Outbox"
        description="Every email the desk has written, and what became of it."
      >
        <Select
          value={status}
          onValueChange={(v) =>
            setStatus(v as OutboundEmailStatus | typeof ANY_STATUS)
          }
        >
          <SelectTrigger className="w-44" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY_STATUS}>Any status</SelectItem>
            {Object.values(OUTBOUND_EMAIL_STATUS).map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PageHeader>

      {/* Said out loud rather than left to be inferred from a page of rows all
          reading "Not sent". From every other screen, "no provider bound" and
          "a quiet week" look identical. */}
      {/* Theme tokens on the card below, not a raw palette colour: there is no
          warning token in this theme, and inventing one here would put a fourth
          hard-coded `amber-500` in the app. The icon and heading carry it. */}
      {data && !data.mailConfigured && (
        <Card className="border-dashed bg-muted/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4" />
              No mail provider is configured
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Nothing below has been sent, and nothing will be until
            <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">
              POSTMARK_SERVER_TOKEN
            </code>
            is set. Until then this page is how invitations and password resets
            reach people — open one and pass on the link it contains.
          </CardContent>
        </Card>
      )}

      {data && (
        <p className="text-sm text-muted-foreground">
          {data.total} email{data.total === 1 ? "" : "s"}
        </p>
      )}

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error.message}
        </p>
      )}

      {isPending && !error && (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading outbox">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))}
        </div>
      )}

      {data && data.emails.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-12 text-center">
          <Inbox className="size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Nothing here yet. Emails appear as the desk writes them.
          </p>
        </div>
      )}

        {data?.emails.map((email) => (
          <OutboxRow
            key={email.id}
            email={email}
            mailConfigured={data.mailConfigured}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The two states the worker settles a row into when it could not deliver it.
 * Mirrors `RETRYABLE_STATUS` in `routes/outbox.ts`, which is the one that
 * actually decides — this only governs whether a button is drawn.
 */
function isRetryable(status: OutboundEmailStatus): boolean {
  return status === "undeliverable" || status === "failed";
}

function OutboxRow({
  email,
  mailConfigured,
}: {
  email: OutboundEmailRow;
  mailConfigured: boolean;
}) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const retry = useMutation({
    mutationFn: async () => {
      await api.post(`/api/outbox/${email.id}/retry`);
    },
    onSuccess: () => {
      // The row is now queued and a worker has it; what it becomes is the
      // server's to say, so refetch rather than guessing at the new status.
      void queryClient.invalidateQueries({ queryKey: ["outbox"] });
    },
  });

  return (
    <Card>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={email.status} />
          <Badge variant="outline">{KIND_LABEL[email.kind]}</Badge>
          {email.ticketId !== null && (
            <Button asChild variant="link" size="sm" className="h-auto p-0">
              <Link to={`/tickets/${email.ticketId}`}>
                Ticket #{email.ticketId}
              </Link>
            </Button>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {new Date(email.createdAt).toLocaleString()}
          </span>
        </div>
        <CardTitle className="text-base">{email.subject}</CardTitle>
        <p className="text-sm text-muted-foreground">
          To {email.toName ? `${email.toName} <${email.toEmail}>` : email.toEmail}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {email.lastError && (
          <p className="text-sm text-muted-foreground">{email.lastError}</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            {open ? "Hide message" : "Show message"}
          </Button>

          {/* Only where it can do something. With no provider bound the server
              refuses the retry outright — it would travel the queue and land
              back on the same status — so the button is not offered either. The
              card at the top of the page is where that is explained. */}
          {isRetryable(email.status) && mailConfigured && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => retry.mutate()}
              disabled={retry.isPending}
            >
              {retry.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RotateCw className="size-4" />
              )}
              {retry.isPending ? "Queueing…" : "Try again"}
            </Button>
          )}
        </div>

        {retry.error && (
          <p className="text-sm text-destructive" role="alert">
            {retry.error.message}
          </p>
        )}
        {/* Plain text in a text node, never `dangerouslySetInnerHTML`. Every
            body here is composed by this app rather than received, but the rule
            in CLAUDE.md is about the habit as much as the input. */}
        {open && (
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">
            {email.textBody}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: OutboundEmailStatus }) {
  const variant =
    status === "sent"
      ? "default"
      : status === "failed"
        ? "destructive"
        : "secondary";
  return <Badge variant={variant}>{STATUS_LABEL[status]}</Badge>;
}
