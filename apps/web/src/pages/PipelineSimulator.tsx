import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, SendHorizonal } from "lucide-react";
import { simulateEmailSchema, type SimulateEmailValues } from "@ticket/core";
import {
  SIMULATED_SENDER_DOMAIN,
  type PipelineConfig,
  type PipelineSimulateResponse,
} from "@ticket/shared";
import { AiShine } from "@/components/AiShine";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import { extractErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import {
  DEFAULT_SCENARIO_ID,
  SCENARIOS,
  type Scenario,
} from "./pipeline-scenarios";

/**
 * Posting an email as if a customer had sent it.
 *
 * It goes to `POST /api/pipeline/simulate`, which hands it to the same
 * `ingestInboundEmail` the Postmark webhook uses. That is the whole reason this
 * is worth having: what you are about to watch is the real path, not a
 * re-enactment of it.
 *
 * The form is deliberately honest about what it does not control. The address is
 * assembled server-side onto a reserved domain and shown here as fixed text, so
 * nobody has to trust a sentence about it — the field simply is not editable.
 * The display *name* is free, because it is the one piece of attacker-supplied
 * text the auto-reply has to neutralise, and typing a hostile one is how you
 * watch that work.
 */

/** Where the reply-to field learns its value from after a send. */
interface LastSend {
  ticketId: number;
  messageId: string;
}

function toValues(scenario: Scenario, inReplyTo = ""): SimulateEmailValues {
  return { ...scenario.values, inReplyTo };
}

export function PipelineSimulator({
  config,
  onSent,
  className,
}: {
  config: PipelineConfig;
  /** Hands the new ticket to the page, which starts polling its trace. */
  onSent: (ticketId: number, scenario: Scenario | null) => void;
  className?: string;
}) {
  const [scenarioId, setScenarioId] = useState<string>(DEFAULT_SCENARIO_ID);
  const [lastSend, setLastSend] = useState<LastSend | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const scenario = SCENARIOS.find((s) => s.id === scenarioId) ?? null;

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<SimulateEmailValues>({
    resolver: zodResolver(simulateEmailSchema),
    defaultValues: toValues(SCENARIOS[0]!),
  });

  // Picking a scenario refills the whole form. Anything typed is discarded,
  // which is the expected reading of "load this scenario" — the alternative is a
  // form that is half one payload and half another and lands somewhere neither
  // of them predicted.
  useEffect(() => {
    if (!scenario) return;
    reset(toValues(scenario));
    setServerError(null);
  }, [scenario, reset]);

  const mutation = useMutation({
    mutationFn: async (values: SimulateEmailValues) => {
      const { data } = await api.post<PipelineSimulateResponse>(
        "/api/pipeline/simulate",
        values,
      );
      return data;
    },
    onSuccess: (data) => {
      setLastSend({ ticketId: data.ticketId, messageId: data.messageId });
      toast.success(
        data.threaded
          ? `Threaded onto ticket #${data.ticketId}`
          : `Ticket #${data.ticketId} received`,
      );
      onSent(data.ticketId, scenario);
    },
    onError: (err) => {
      const message = extractErrorMessage(err, "Could not send the email");
      setServerError(message);
      toast.error(message);
    },
  });

  const onSubmit = handleSubmit((values) => {
    setServerError(null);
    return mutation.mutateAsync(values).catch(() => {
      // Reported above; swallowed so a failed send does not reject out of the
      // submit handler and land in the console as an unhandled rejection.
    });
  });

  const disabled = !config.simulatorEnabled;
  const busy = isSubmitting || mutation.isPending;

  return (
    <section
      className={cn("rounded-lg border bg-card p-4", className)}
      aria-labelledby="simulator-heading"
    >
      <h2 id="simulator-heading" className="text-sm font-semibold">
        Send an email as a customer
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Posted through the same ingestion code the mail webhook uses, so what
        happens next is the real pipeline. The address is always on{" "}
        <span className="font-mono">{SIMULATED_SENDER_DOMAIN}</span>, which is a
        reserved domain — nothing here can reach a real person.
      </p>

      {disabled && (
        <p
          role="status"
          className="mt-3 rounded-md border border-ember-2/40 bg-ember-2/5 p-3 text-xs leading-relaxed text-ember-2"
        >
          The simulator is off on this deployment. Set{" "}
          <span className="font-mono">PIPELINE_SIMULATOR_ENABLED=true</span> to
          turn it on. It creates real tickets and spends real model calls, so it
          is off unless somebody says otherwise.
        </p>
      )}

      <form onSubmit={onSubmit} className="mt-4 space-y-4">
        <fieldset disabled={disabled || busy} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="scenario">Scenario</Label>
            <Select value={scenarioId} onValueChange={setScenarioId}>
              <SelectTrigger id="scenario" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Ordinary mail</SelectLabel>
                  {SCENARIOS.filter((s) => !s.adversarial).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>Payloads</SelectLabel>
                  {SCENARIOS.filter((s) => s.adversarial).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {scenario && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {scenario.note}
              </p>
            )}
          </div>

          {/* Stacked, not a two-column grid. This panel is 22rem wide on a wide
              screen and the whole width of a phone on a narrow one, and the
              address row needs every pixel of it — half of one of these columns
              showed two characters of the localpart. */}
          <div className="space-y-1.5">
            <Label htmlFor="senderName">Display name</Label>
            <Input id="senderName" {...register("senderName")} />
            <p className="text-xs leading-relaxed text-muted-foreground">
              Attacker-controlled in a real email, so it never reaches the model.
              Try a hostile one.
            </p>
            {errors.senderName && (
              <p className="text-xs text-destructive">
                {errors.senderName.message}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="localPart">From</Label>
            <div className="flex items-center gap-1.5">
              <Input
                id="localPart"
                className="min-w-0 flex-1"
                {...register("localPart")}
              />
              {/* Not an input. The domain is decided by the server whatever is
                  typed here, and drawing it as a disabled field would imply
                  somebody could argue with it. */}
              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                @{SIMULATED_SENDER_DOMAIN}
              </span>
            </div>
            {errors.localPart && (
              <p className="text-xs text-destructive">
                {errors.localPart.message}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="subject">Subject</Label>
            <Input id="subject" {...register("subject")} />
            {errors.subject && (
              <p className="text-xs text-destructive">
                {errors.subject.message}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="textBody">Message</Label>
            <Textarea id="textBody" rows={8} {...register("textBody")} />
            {errors.textBody && (
              <p className="text-xs text-destructive">
                {errors.textBody.message}
              </p>
            )}
          </div>

          {/* The hints sit under the label, not inside it: shadcn's `Label` is a
              flex row, so a span in there becomes a sibling column and the two
              words of the label wrap to three lines beside it. */}
          <div className="space-y-1.5">
            <Label htmlFor="htmlBody">HTML body</Label>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Stored, never rendered, never sent to a model.
            </p>
            <Textarea id="htmlBody" rows={2} {...register("htmlBody")} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="inReplyTo">In-Reply-To</Label>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Optional. Threads onto an existing simulated ticket.
            </p>
            <Input
              id="inReplyTo"
              className="font-mono text-xs"
              placeholder="Leave empty to open a new ticket"
              {...register("inReplyTo")}
            />
            {lastSend && (
              // What this actually shows is threading and the reopen rule: the
              // message joins the existing thread instead of opening a ticket,
              // and a ticket the machine resolved goes back to Open. It does
              // *not* re-run the pipeline — the auto-reply is enqueued once,
              // from the classify handler, and a reply on an existing thread
              // does not re-classify anything.
              <button
                type="button"
                className="text-left text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                onClick={() => setValue("inReplyTo", lastSend.messageId)}
              >
                Reply to ticket #{lastSend.ticketId} — threads onto it, and
                reopens it if the machine had resolved it
              </button>
            )}
          </div>
        </fieldset>

        {serverError && (
          <p role="alert" className="text-sm text-destructive">
            {serverError}
          </p>
        )}

        <div className="relative inline-block rounded-md">
          <AiShine active={busy} />
          <Button type="submit" disabled={disabled || busy}>
            {busy ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : (
              <SendHorizonal aria-hidden="true" />
            )}
            Send as customer
          </Button>
        </div>
      </form>
    </section>
  );
}
