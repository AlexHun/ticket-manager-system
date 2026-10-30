import type { Locator } from "@playwright/test";

/**
 * Whether `item` is laid out on `heading`'s line, inside the window: its
 * middle falls within the heading's box and its right edge within the
 * viewport. Read for `expect.poll`, since a badge that mounts after first
 * paint can move the row (#692).
 */
export async function onHeadingLine(heading: Locator, item: Locator) {
  const [h, box] = await Promise.all([
    heading.boundingBox(),
    item.boundingBox(),
  ]);
  const viewport = heading.page().viewportSize();
  if (!h || !box || !viewport) return false;
  const middle = box.y + box.height / 2;
  return (
    middle > h.y &&
    middle < h.y + h.height &&
    box.x + box.width <= viewport.width
  );
}
