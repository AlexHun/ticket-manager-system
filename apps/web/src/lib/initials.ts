/**
 * The letters an avatar falls back to when there is no picture — and there
 * never is one here, since customers arrive by email and users have no upload.
 *
 * First and last initial, because a middle name shouldn't push out the surname.
 * Two letters is the cap: past that the glyphs shrink to fit the circle and
 * stop reading as initials at all.
 */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";

  const letters =
    parts.length === 1
      ? parts[0].slice(0, 2)
      : parts[0][0] + parts[parts.length - 1][0];

  return letters.toUpperCase();
}
