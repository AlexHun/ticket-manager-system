import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Loader2, Pause, Play, X } from "lucide-react";
import {
  EVAL_CORPUS,
  EVAL_CORPUS_DEFAULT,
  EVAL_PLAN_HORIZON_DAYS,
  EVAL_PLANNED_RUN_STATUS,
  type EvalCorpus,
  type EvalPlannedRunRow,
  type EvalScheduleResponse,
} from "@ticket/shared";
import { type EvalScheduleValues, type PlanEvalRunValues } from "@ticket/core";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { CORPUS_LABEL } from "@/lib/eval-labels";
import { evalKeys } from "@/lib/eval-queries";
import { extractErrorMessage } from "@/lib/errors";

/**
 * When runs happen: the standing schedule, and the runs planned for a
 * particular afternoon (#236).
 *
 * **Two halves of one panel, and they are different things on purpose.** The
 * schedule fires forever, is frozen-corpus only, and is *paused* — it keeps its
 * time and there is no delete. A planned run fires once, may name either
 * corpus, and is *cancelled* — it never becomes a run. The two verbs are not
 * interchangeable and the copy is where that gets read: one verb across both is
 * how an admin comes to believe that pausing the schedule stops tonight's run.
 *
 * **Nothing here ends a run already in flight, because there is no such act**
 * (`docs/adr/0021`). The pause confirmation says so outright rather than
 * leaving it to be assumed, and it deliberately does not point at another
 * control — there isn't one.
 *
 * **Plain state rather than react-hook-form**, which is the shape the other
 * control bars here take (`ActivityFilters`, `TicketsFilters`) while the
 * genuine forms — the dialogs, the sign-in pages, the pipeline simulator — use
 * RHF. Nothing here submits a form: there are four independent controls and
 * three buttons, each firing its own mutation, and no field displays an error
 * of its own. What the schemas in `@ticket/core` are still good for is the
 * *shape* each mutation sends, so the client and the route cannot drift about
 * what a schedule or a plan is — hence `EvalScheduleValues` and
 * `PlanEvalRunValues` below rather than two inline object types.
 */

/** `05:15` from the stored pair, which is what an `<input type="time">` reads. */
function toTimeValue(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** The pair back, or `null` for anything an input might hand over half-typed. */
function fromTimeValue(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;

  return { hour, minute };
}

/** A date, in the viewer's own zone, as `<input type="date">` spells one. */
function toDateValue(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

const DATE_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function EvalSchedulePanel() {
  const queryClient = useQueryClient();

  const { data, isPending, error } = useQuery({
    queryKey: evalKeys.schedule(),
    queryFn: async ({ signal }) => {
      const { data } = await api.get<EvalScheduleResponse>(
        "/api/evals/schedule",
        { signal },
      );
      return data;
    },
  });

  /**
   * The edited time, or `null` for "whatever the server last said".
   *
   * Derived at render rather than synced in an effect, which is the shape that
   * survives a refetch: an effect copying the response into state would either
   * clobber what somebody is typing or need a guard, and `StrictMode`
   * double-invokes those on mount.
   */
  const [editedTime, setEditedTime] = useState<string | null>(null);
  const [confirmingPause, setConfirmingPause] = useState(false);

  const [planDate, setPlanDate] = useState<Date | undefined>(undefined);
  const [planTime, setPlanTime] = useState("");
  const [planCorpus, setPlanCorpus] = useState<EvalCorpus>(EVAL_CORPUS_DEFAULT);
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const schedule = data?.schedule;
  /** The time in force: what pausing and resuming keep, whatever is typed. */
  const storedTime = schedule
    ? { hour: schedule.hour, minute: schedule.minute }
    : null;
  const timeValue =
    editedTime ??
    (storedTime ? toTimeValue(storedTime.hour, storedTime.minute) : "");
  /** The typed time — only ever sent by Save, never by Pause or Resume. */
  const typedTime = fromTimeValue(timeValue);
  const timeChanged =
    storedTime !== null &&
    typedTime !== null &&
    (typedTime.hour !== storedTime.hour ||
      typedTime.minute !== storedTime.minute);

  const saveSchedule = useMutation({
    mutationFn: async (values: EvalScheduleValues) => {
      await api.patch("/api/evals/schedule", values);
    },
    onSuccess: (_result, values) => {
      setEditedTime(null);
      setConfirmingPause(false);
      void queryClient.invalidateQueries({ queryKey: evalKeys.schedule() });
      toast.success(
        values.paused
          ? "Schedule paused"
          : "Schedule saved — it takes effect now",
      );
    },
    onError: (err) => {
      toast.error(extractErrorMessage(err, "Could not save the schedule"));
    },
  });

  const planRun = useMutation({
    mutationFn: async (values: PlanEvalRunValues) => {
      await api.post("/api/evals/planned-runs", {
        corpus: values.corpus,
        runAt: values.runAt.toISOString(),
      });
    },
    onSuccess: () => {
      setPlanDate(undefined);
      setPlanTime("");
      void queryClient.invalidateQueries({ queryKey: evalKeys.schedule() });
      toast.success("Run planned");
    },
    onError: (err) => {
      toast.error(extractErrorMessage(err, "Could not plan the run"));
    },
  });

  const cancelPlan = useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/api/evals/planned-runs/${id}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: evalKeys.schedule() });
      toast.success("Planned run cancelled");
    },
    onError: (err) => {
      toast.error(extractErrorMessage(err, "Could not cancel the planned run"));
    },
  });

  /** The instant the form describes, in the viewer's own zone. */
  const plannedAt = (() => {
    const time = fromTimeValue(planTime);
    if (!planDate || !time) return null;

    const at = new Date(planDate);
    at.setHours(time.hour, time.minute, 0, 0);
    return at;
  })();
  const plannedAtIsFuture =
    plannedAt !== null && plannedAt.getTime() > Date.now();

  const canRun = data?.evalConfigured !== false;

  if (isPending) return <Skeleton className="h-40 w-full" />;

  if (error || !data) {
    return (
      <p className="text-sm text-muted-foreground">
        {extractErrorMessage(error, "Could not load the schedule")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nightly schedule</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* Frozen only, and said out loud rather than offered as a control
              that is always disabled. An unattended trend line has to be
              attributable: a live-corpus run moves when an admin edits an
              article, so a red result in it is ambiguous between a prompt
              regression and somebody rewording an article that morning. */}
          <p className="text-sm text-muted-foreground">
            One run a night against the frozen corpus, so the trend it draws
            moves only when the code does. A run against the live corpus is
            something a person asks for — plan one below.
          </p>

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="eval-schedule-time">Time (server clock)</Label>
              <Input
                id="eval-schedule-time"
                type="time"
                className="w-36"
                value={timeValue}
                onChange={(event) => setEditedTime(event.target.value)}
                disabled={saveSchedule.isPending}
              />
            </div>

            <Button
              onClick={() =>
                typedTime &&
                saveSchedule.mutate({
                  ...typedTime,
                  paused: data.schedule.paused,
                })
              }
              disabled={!timeChanged || saveSchedule.isPending}
            >
              {saveSchedule.isPending && (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              )}
              Save time
            </Button>

            {/* Resuming needs no confirmation — it starts nothing now, it only
                lets the next night happen. Pausing does, because of what an
                admin might reasonably think it reaches.

                **Both send the stored time, never the typed one.** Save is the
                only control that commits what is in the field; a Pause that
                carried an uncommitted edit would retime the schedule as a side
                effect of turning it off, which is the one thing "pausing keeps
                the time" promises it does not do. */}
            {data.schedule.paused ? (
              <Button
                variant="outline"
                onClick={() =>
                  storedTime &&
                  saveSchedule.mutate({ ...storedTime, paused: false })
                }
                disabled={saveSchedule.isPending}
              >
                <Play className="size-4" aria-hidden />
                Resume
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={() => setConfirmingPause(true)}
                disabled={saveSchedule.isPending}
              >
                <Pause className="size-4" aria-hidden />
                Pause
              </Button>
            )}

            {data.schedule.paused && <Badge variant="outline">Paused</Badge>}
          </div>

          <p className="text-sm text-muted-foreground">
            {data.schedule.updatedByName
              ? `Last changed by ${data.schedule.updatedByName} on ${DATE_TIME_FORMAT.format(new Date(data.schedule.updatedAt))}.`
              : "Never changed — this is the time the nightly has always kept."}
          </p>
        </CardContent>
      </Card>

      <Dialog open={confirmingPause} onOpenChange={setConfirmingPause}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pause the nightly schedule?</DialogTitle>
            {/* The one sentence this dialog exists for. An admin pausing at
                03:50 is pausing because a run is going, and the honest answer
                is that nothing reaches it — so this says so and points at no
                other control, because there is no other control. */}
            <DialogDescription>
              The schedule keeps{" "}
              {storedTime && toTimeValue(storedTime.hour, storedTime.minute)}{" "}
              and stops firing until you resume it. A run already under way is
              unaffected — an eval run always runs to completion, and nothing
              ends one early.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Keep it running</Button>
            </DialogClose>
            <Button
              onClick={() =>
                storedTime &&
                saveSchedule.mutate({ ...storedTime, paused: true })
              }
              disabled={saveSchedule.isPending}
            >
              {saveSchedule.isPending && (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              )}
              Pause schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Planned runs</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            One run, at a time you pick, against either corpus. A planned run
            has measured nothing yet, so it is not listed among the runs below —
            it joins them when it fires.
          </p>

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="eval-plan-date">Date</Label>
              <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    id="eval-plan-date"
                    variant="outline"
                    className="w-44 justify-start font-normal"
                    disabled={!canRun || planRun.isPending}
                  >
                    <CalendarDays className="size-4" aria-hidden />
                    {planDate ? toDateValue(planDate) : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={planDate}
                    onSelect={(date) => {
                      setPlanDate(date);
                      setDatePickerOpen(false);
                    }}
                    // The same ceiling the route enforces, so the form cannot
                    // offer a day the server will refuse — see
                    // `EVAL_PLAN_HORIZON_DAYS`, where the limit is the queue's
                    // own retention rather than a product opinion.
                    disabled={{
                      before: new Date(),
                      after: new Date(
                        Date.now() + EVAL_PLAN_HORIZON_DAYS * 86_400_000,
                      ),
                    }}
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="eval-plan-time">Time</Label>
              <Input
                id="eval-plan-time"
                type="time"
                className="w-36"
                value={planTime}
                onChange={(event) => setPlanTime(event.target.value)}
                disabled={!canRun || planRun.isPending}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="eval-plan-corpus">Corpus for this run</Label>
              <Select
                value={planCorpus}
                onValueChange={(value) => setPlanCorpus(value as EvalCorpus)}
                disabled={!canRun || planRun.isPending}
              >
                <SelectTrigger id="eval-plan-corpus" className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(EVAL_CORPUS).map((option) => (
                    <SelectItem key={option} value={option}>
                      {CORPUS_LABEL[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              onClick={() =>
                plannedAt &&
                planRun.mutate({ corpus: planCorpus, runAt: plannedAt })
              }
              disabled={!canRun || !plannedAtIsFuture || planRun.isPending}
            >
              {planRun.isPending && (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              )}
              Plan run
            </Button>
          </div>

          {data.plannedRuns.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing planned.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.plannedRuns.map((row) => (
                <PlannedRow
                  key={row.id}
                  row={row}
                  onCancel={() => cancelPlan.mutate(row.id)}
                  cancelling={
                    cancelPlan.isPending && cancelPlan.variables === row.id
                  }
                />
              ))}
            </ul>
          )}

          {/* Said once, under the list, because it is the question an admin
              asks the moment a plan is an hour out: re-timing is cancel and
              plan again. One write path, one queued job, and no window where
              the row and the queue disagree about when it fires. */}
          <p className="text-sm text-muted-foreground">
            To move a planned run, cancel it and plan it again.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/** One planned run, or one that did not happen. */
function PlannedRow({
  row,
  onCancel,
  cancelling,
}: {
  row: EvalPlannedRunRow;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const missed = row.status === EVAL_PLANNED_RUN_STATUS.missed;

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-sm">
      <span className="font-medium">
        {DATE_TIME_FORMAT.format(new Date(row.runAt))}
      </span>
      <Badge variant="outline">{CORPUS_LABEL[row.corpus]}</Badge>
      {/* Visibly not a run: "Upcoming" is a claim about the future and every
          badge on a run card is a claim about a measurement. */}
      <Badge variant={missed ? "destructive" : "secondary"}>
        {missed ? "Missed" : "Upcoming"}
      </Badge>
      <span className="text-muted-foreground">
        {missed
          ? "Its time passed while nothing was there to fire it. It started nothing."
          : row.plannedByName
            ? `Planned by ${row.plannedByName}`
            : "Planned"}
      </span>
      {!missed && (
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={onCancel}
          disabled={cancelling}
        >
          {cancelling ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <X className="size-4" aria-hidden />
          )}
          Cancel
        </Button>
      )}
    </li>
  );
}
