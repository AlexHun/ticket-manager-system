/**
 * Shared diffing shape for the two audit-trail writers (`admin-activity.ts`'s
 * `userEditChanges`, `ticket-activity.ts`'s `ticketChanges`): compare two
 * readings of a record field-by-field and return one entry per changed
 * field. Actor construction stays in each module — this is the diffing loop
 * only, which was the actual duplication.
 */

/** One field to diff: which field, what action it writes if changed, and an optional label prefixed onto the value strings. */
export interface DiffField<T, A> {
  field: keyof T;
  action: A;
  label?: string;
}

export interface DiffEntry<A> {
  action: A;
  fromValue: string | null;
  toValue: string | null;
}

/**
 * Returns nothing for a field that didn't change — that's what keeps a PATCH
 * that re-sends an unchanged value out of the trail.
 */
export function diffToEntries<T, A>(
  before: T,
  after: T,
  fields: DiffField<T, A>[],
): DiffEntry<A>[] {
  const entries: DiffEntry<A>[] = [];

  for (const { field, action, label } of fields) {
    const fromRaw = before[field];
    const toRaw = after[field];
    if (fromRaw === toRaw) continue;

    entries.push({
      action,
      fromValue: formatValue(fromRaw, label),
      toValue: formatValue(toRaw, label),
    });
  }

  return entries;
}

function formatValue(value: unknown, label?: string): string | null {
  if (value === null || value === undefined) return null;
  return label ? `${label}: ${value}` : String(value);
}
