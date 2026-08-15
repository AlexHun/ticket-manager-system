import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Loader2, UserRoundCheck } from "lucide-react";
import type { UpdateHandoffValues } from "@ticket/core";
import {
  HANDOFF_TARGET,
  type AutomationSettings,
  type AutomationSettingsResponse,
} from "@ticket/shared";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import { automationKeys } from "@/lib/automation-queries";
import { extractErrorMessage } from "@/lib/errors";
import { useAssigneesQuery } from "@/lib/use-assignees";

/**
 * Where a ticket goes once the assistant is finished with it.
 *
 * The rail above this shows tickets leaving the pipeline at six different
 * stops. Every one of those exits used to land in the same place — `Open`, with
 * nobody's name on it, which is also what a ticket looks like when it has just
 * arrived and nothing has happened to it yet. This is the control that fixes
 * that, and it sits on this page rather than on a settings screen of its own
 * because the exits it routes are drawn ten pixels above it.
 *
 * Two rows, and only one of them is a control. That asymmetry is the design:
 * filing a resolved ticket under the assistant is a *record* of what happened
 * and is fixed in code, while deciding who inherits the ones it could not
 * finish is a staffing question with no right answer. Offering to point the
 * first one at a colleague would mean filing a machine's work under a person's
 * name.
 */

/**
 * One flat picker rather than a mode radio and a user select beside it.
 *
 * The two automatic targets travel as their own tokens and a person travels as
 * their id, in the same way `ASSIGNEE_NONE` rides in the tickets query string:
 * ids here are Better Auth cuids, 32 characters long, so neither token can
 * collide with one. The mapping back to `{ target, userId }` happens at the one
 * boundary below, so the API keeps the pair that can be validated as a pair.
 */
function toBody(value: string): UpdateHandoffValues {
  if (value === HANDOFF_TARGET.admin || value === HANDOFF_TARGET.unassigned) {
    return { target: value, userId: null };
  }
  return { target: HANDOFF_TARGET.user, userId: value };
}

/** The inverse: which row of the picker the stored setting is showing. */
function toValue(settings: AutomationSettings): string {
  if (settings.target === HANDOFF_TARGET.user && settings.user) {
    return settings.user.id;
  }
  return settings.target;
}

function useSettings() {
  return useQuery({
    queryKey: automationKeys.settings,
    queryFn: async ({ signal }) => {
      const { data } = await api.get<AutomationSettingsResponse>(
        "/api/automation",
        { signal },
      );
      return data.settings;
    },
  });
}

export function PipelineHandoff() {
  const queryClient = useQueryClient();
  const settings = useSettings();
  const { data: roster, error: rosterError } = useAssigneesQuery();

  const mutation = useMutation({
    mutationFn: async (value: string) => {
      const { data } = await api.patch<AutomationSettingsResponse>(
        "/api/automation/handoff",
        toBody(value),
      );
      return data.settings;
    },
    onSuccess: (updated) => {
      // Seeded rather than invalidated: the response *is* the new settings,
      // including the resolved name, so refetching would ask the same question
      // again and leave the line under the picker stale for a round trip.
      queryClient.setQueryData(automationKeys.settings, updated);
      toast.success(
        updated.resolvedTo
          ? `Handed-back tickets now go to ${updated.resolvedTo.name}`
          : "Handed-back tickets will be left unassigned",
      );
    },
    onError: (error) => {
      toast.error(extractErrorMessage(error, "Failed to save the handoff"));
    },
  });

  // Bound to a const so the change handler below can narrow it. Reading
  // `settings.data` inside the closure would be `AutomationSettings | undefined`
  // however plainly the JSX around it has already checked.
  const current = settings.data;

  return (
    <section
      aria-labelledby="handoff-heading"
      className="rounded-lg border bg-card p-5"
    >
      <h2 id="handoff-heading" className="font-heading text-base font-semibold">
        Who ends up with it
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Every ticket leaving the rail gets an owner, so the ones the assistant
        dealt with stop looking like the ones nobody has opened.
      </p>

      {settings.error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {extractErrorMessage(settings.error, "Failed to load the settings")}
        </p>
      )}

      {settings.isPending && <Skeleton className="mt-4 h-24 w-full" />}

      {current && (
        <dl className="mt-4 grid gap-x-6 gap-y-5 sm:grid-cols-2">
          <div>
            <dt className="flex items-center gap-1.5 text-sm font-medium">
              <Bot aria-hidden="true" className="size-4 text-muted-foreground" />
              Answered and resolved
            </dt>
            <dd className="mt-2">
              {current.assistant ? (
                <>
                  <p className="text-sm">{current.assistant.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Fixed. A resolved ticket is filed under the assistant because
                    that is what happened to it, not because anyone chose.
                  </p>
                </>
              ) : (
                /* The account is created by `bun run db:seed`, so a database
                   seeded before this feature existed has none. Saying so beats
                   an empty Assignee column nobody can explain. */
                <p className="text-sm text-muted-foreground">
                  No assistant account — run the seed to create one. Until then
                  resolved tickets stay unassigned.
                </p>
              )}
            </dd>
          </div>

          <div>
            <dt
              className="flex items-center gap-1.5 text-sm font-medium"
              id="handoff-label"
            >
              <UserRoundCheck
                aria-hidden="true"
                className="size-4 text-muted-foreground"
              />
              Handed back to a person
            </dt>
            <dd className="mt-2">
              <div className="flex items-center gap-2">
                <Select
                  value={toValue(current)}
                  onValueChange={(value) => {
                    // Radix fires this when the open menu closes on the row that
                    // is already selected. Without the guard that is a PATCH
                    // that changes nothing and a toast saying so.
                    if (value !== toValue(current)) mutation.mutate(value);
                  }}
                  disabled={mutation.isPending}
                >
                  <SelectTrigger
                    aria-labelledby="handoff-label"
                    className="w-full"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>Automatic</SelectLabel>
                      <SelectItem value={HANDOFF_TARGET.admin}>
                        An admin
                      </SelectItem>
                      <SelectItem value={HANDOFF_TARGET.unassigned}>
                        Nobody — leave it in the queue
                      </SelectItem>
                    </SelectGroup>
                    {(roster ?? []).length > 0 && (
                      <SelectGroup>
                        <SelectLabel>Someone specific</SelectLabel>
                        {(roster ?? []).map((user) => (
                          <SelectItem key={user.id} value={user.id}>
                            {user.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                  </SelectContent>
                </Select>
                {mutation.isPending && (
                  <span role="status" className="text-muted-foreground">
                    <Loader2
                      aria-hidden="true"
                      className="size-4 shrink-0 animate-spin"
                    />
                    <span className="sr-only">Saving</span>
                  </span>
                )}
              </div>
              <HandoffStatus
                settings={current}
                rosterError={rosterError}
              />
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}

/**
 * The line under the picker: who the *next* handed-back ticket actually goes to.
 *
 * Not decoration. "An admin" names nobody on its own, and a target pointing at a
 * colleague who has since been deleted silently degrades to an admin — both read
 * as settled in the control above and are answered here, with the same name the
 * job would write, computed by the same function on the server.
 */
function HandoffStatus({
  settings,
  rosterError,
}: {
  settings: AutomationSettings;
  rosterError: unknown;
}) {
  if (rosterError) {
    return (
      <p className="mt-1.5 text-xs text-destructive" role="alert">
        Couldn't load the list of users.
      </p>
    );
  }

  const stale =
    settings.target === HANDOFF_TARGET.user &&
    settings.user !== null &&
    settings.resolvedTo?.id !== settings.user.id;

  return (
    <div className="mt-1.5 space-y-1 text-xs text-muted-foreground">
      <p>
        {settings.resolvedTo
          ? `Right now that's ${settings.resolvedTo.name}.`
          : "Right now nobody — these tickets go back to the queue unowned."}
        {stale && " The person you picked is no longer on the roster."}
      </p>
      {settings.updatedByName && (
        <p>
          Last changed by {settings.updatedByName}
          {settings.updatedAt &&
            ` on ${new Date(settings.updatedAt).toLocaleDateString()}`}
          .
        </p>
      )}
    </div>
  );
}
