import { Loader2 } from "lucide-react";
import {
  AGENT_SETTABLE_STATUS,
  TICKET_CATEGORY,
  type TicketCategory,
  type TicketStatus,
  type TicketWithAssignee,
} from "@ticket/shared";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { extractErrorMessage } from "@/lib/errors";
import { useTicketField } from "@/lib/use-ticket-field";

/** The triggers' ids, so the detail page's `<dt>`s can label them. */
export const STATUS_SELECT_ID = "ticket-status";
export const CATEGORY_SELECT_ID = "ticket-category";

const STATUS_ERROR = "Failed to update the status";
const CATEGORY_ERROR = "Failed to update the category";

/**
 * Radix reserves the empty string for "cleared" and rejects it as an item
 * value, so "no category" needs a token of its own. It never leaves this
 * module — the API gets a real `null`.
 *
 * Deliberately not `CATEGORY_NONE`: that sentinel exists because a query string
 * can't carry a null, which is a different problem in a different place.
 */
const UNCATEGORISED = "uncategorised";

type CategoryValue = TicketCategory | typeof UNCATEGORISED;

interface FieldOption<T extends string> {
  value: T;
  /** Shown both in the row and, once chosen, in the trigger. */
  label: string;
  /** Rendered so the trigger has a label, but not selectable. */
  disabled?: boolean;
}

/**
 * Plain labels, not badges. The coloured badge for this value is already in the
 * page header — this is the control that changes it, and a control that looks
 * unlike every other select on the page is a worse control for being prettier.
 *
 * `AGENT_SETTABLE_STATUS`, not every status, because the API only accepts these
 * three: `New` is where a ticket begins and there is nothing to put one back
 * for, and `Processing` is a claim a background worker holds — a person able to
 * set it could hide any ticket from every agent with nothing scheduled to
 * release it. A ticket *currently* in one of those two is handled by
 * `statusOptions` below.
 */
const STATUS_OPTIONS: FieldOption<TicketStatus>[] = AGENT_SETTABLE_STATUS.map(
  (status) => ({ value: status, label: status }),
);

/**
 * The three settable statuses, plus the ticket's own if it is not one of them.
 *
 * Radix draws an **empty trigger** for a value it has no item for, so a New or
 * Processing ticket would show a blank status control — the same trap the
 * assignee filter documents. The extra row is disabled: it exists to give the
 * trigger a label and to say what the ticket is, not to be chosen.
 */
function statusOptions(current: TicketStatus): FieldOption<TicketStatus>[] {
  const settable = AGENT_SETTABLE_STATUS.some((status) => status === current);
  return settable
    ? STATUS_OPTIONS
    : [{ value: current, label: current, disabled: true }, ...STATUS_OPTIONS];
}

/**
 * "Uncategorised" leads, as "Unassigned" does in the assignee picker: it is the
 * state a ticket arrives in and the one to put it back to, not a fifth
 * category, so it reads as the odd one out at the top rather than as a peer
 * filed among them.
 */
const CATEGORY_OPTIONS: FieldOption<CategoryValue>[] = [
  { value: UNCATEGORISED, label: "Uncategorised" },
  ...Object.values(TICKET_CATEGORY).map((category) => ({
    value: category,
    label: category,
  })),
];

export function TicketStatusSelect({ ticket }: { ticket: TicketWithAssignee }) {
  const mutation = useTicketField<TicketStatus>({
    ticketId: ticket.id,
    field: "status",
    toBody: (status) => ({ status }),
    describe: (updated) => `Status set to ${updated.status}`,
    errorMessage: STATUS_ERROR,
  });

  // While the request is in flight the trigger shows what was picked, not what
  // the server last confirmed — otherwise the control snaps back to the old
  // value for the length of a round trip and reads as if the click was ignored.
  const value =
    mutation.isPending && mutation.variables
      ? mutation.variables
      : ticket.status;

  return (
    <FieldSelect
      id={STATUS_SELECT_ID}
      // Fills the sidebar column once the card is a sidebar. flex-1 rather
      // than w-full because the saving spinner shares the row with it.
      className="w-44 lg:flex-1"
      value={value}
      options={statusOptions(value)}
      pending={mutation.isPending}
      error={mutation.error}
      savingLabel="Saving status"
      errorFallback={STATUS_ERROR}
      onChange={(next) => {
        if (next !== ticket.status) mutation.mutate(next);
      }}
    />
  );
}

export function TicketCategorySelect({
  ticket,
}: {
  ticket: TicketWithAssignee;
}) {
  const mutation = useTicketField<CategoryValue>({
    ticketId: ticket.id,
    field: "category",
    toBody: (value) => ({
      category: value === UNCATEGORISED ? null : value,
    }),
    describe: (updated) =>
      updated.category
        ? `Category set to ${updated.category}`
        : "Category cleared",
    errorMessage: CATEGORY_ERROR,
  });

  const current = ticket.category ?? UNCATEGORISED;
  const value =
    mutation.isPending && mutation.variables ? mutation.variables : current;

  return (
    <FieldSelect
      id={CATEGORY_SELECT_ID}
      // Fills the sidebar column once the card is a sidebar. flex-1 rather
      // than w-full because the saving spinner shares the row with it.
      className="w-44 lg:flex-1"
      value={value}
      options={CATEGORY_OPTIONS}
      pending={mutation.isPending}
      error={mutation.error}
      savingLabel="Saving category"
      errorFallback={CATEGORY_ERROR}
      onChange={(next) => {
        if (next !== current) mutation.mutate(next);
      }}
    />
  );
}

/**
 * The shell both fields share: a select that saves the moment it changes, greys
 * out until the server answers, and explains a refusal underneath.
 *
 * There is no Save button and no dirty state on purpose — one field, one
 * choice, and nothing to confirm that the toast and the badge don't already
 * say.
 */
function FieldSelect<T extends string>({
  id,
  className,
  value,
  options,
  pending,
  error,
  savingLabel,
  errorFallback,
  onChange,
}: {
  id: string;
  className: string;
  value: T;
  options: FieldOption<T>[];
  pending: boolean;
  error: unknown;
  savingLabel: string;
  errorFallback: string;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Select
          value={value}
          // Radix hands back a bare string, but it can only ever be one of the
          // item values rendered below — the one place the widening is undone.
          onValueChange={(next) => onChange(next as T)}
          disabled={pending}
        >
          <SelectTrigger id={id} className={className}>
            {/* Bare, unlike the assignee picker: every option is rendered from
                the start, so Radix can read the label off the chosen one and
                there is nothing to fill in while a roster loads. */}
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                disabled={option.disabled}
              >
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* The control greys out while saving, which says nothing on its own to
            a screen reader — the live region is what announces the wait.

            `relative` so the sr-only text inside is positioned against this
            rather than against the page — see TicketMessageThread. */}
        {pending && (
          <span role="status" className="relative text-muted-foreground">
            <Loader2
              aria-hidden="true"
              className="size-4 shrink-0 animate-spin"
            />
            <span className="sr-only">{savingLabel}</span>
          </span>
        )}
      </div>

      {Boolean(error) && (
        <p className="text-xs text-destructive" role="alert">
          {extractErrorMessage(error, errorFallback)}
        </p>
      )}
    </div>
  );
}
