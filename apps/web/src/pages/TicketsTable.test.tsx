import { act } from "react";
import { screen } from "@testing-library/react";
import {
  TICKET_STATUS,
  TICKET_SORT_FIELD,
  type TicketWithAssignee,
} from "@ticket/shared";
import { renderRoutes } from "@/test/render";
import { TicketsTable } from "./TicketsTable";

/**
 * The drag race from issue #263, at the only seam that can hold it.
 *
 * Playwright cannot: the trigger is a React update already pending on the
 * table's fiber when the drag's first `mousemove` is processed, and in a real
 * browser that is whatever the runner happened to be doing — a refetch, an SSE
 * reconnect — which is exactly why it only ever failed on CI. Here the same
 * state is produced on purpose by dispatching the whole drag inside one `act`,
 * so React batches it instead of flushing between events.
 *
 * What went wrong when it fired: TanStack's resize handler fills a closure
 * object with the new sizes from inside the `setColumnSizingInfo` updater and
 * reads it back from inside the `setColumnSizing` updater. With `columnSizing`
 * lifted into a `useState` above `useReactTable`, those two updaters lived in
 * different hooks and React ran the consumer first — it spread an empty object
 * and the column came back at the *exact* width it started at.
 *
 * The three cases differ in one variable only: where React is allowed to flush.
 * The first is the **control** and passed before the fix too — with nothing
 * queued, React evaluates each dispatch eagerly and the producer still wins.
 * The other two are the reproduction, and both went to a flat zero delta
 * against the old component, not to a partial one.
 *
 * They assert the full delta rather than merely "wider" for that reason: a
 * partial application would be a different bug, and `toBeGreaterThan` would
 * wave it through alongside a correct drag.
 */

const tickets: TicketWithAssignee[] = Array.from({ length: 3 }, (_, i) => ({
  id: i + 1,
  subject: `Ticket ${i + 1}`,
  status: TICKET_STATUS.New,
  category: null,
  customerEmail: `customer${i + 1}@example.com`,
  customerName: `Customer ${i + 1}`,
  assignedToId: null,
  assignedTo: null,
  lastMessageAt: new Date(Date.UTC(2025, 0, i + 1)).toISOString(),
  createdAt: new Date(Date.UTC(2025, 0, i + 1)).toISOString(),
  updatedAt: new Date(Date.UTC(2025, 0, i + 1)).toISOString(),
}));

function mount() {
  renderRoutes([
    {
      path: "/",
      element: (
        <TicketsTable
          tickets={tickets}
          sorting={[{ id: TICKET_SORT_FIELD.createdAt, desc: true }]}
          onSortingChange={() => {}}
        />
      ),
    },
  ]);
}

/**
 * jsdom lays nothing out, so `getBoundingClientRect` is all zeroes and the E2E's
 * reading is unavailable here. The `<colgroup>` widths are the same state one
 * step earlier — what the component asked the browser for — and they are what
 * a no-op drag leaves untouched.
 *
 * The `<col>` elements carry nothing identifying, so the column is found by
 * position among the headers, which render from the same list in the same
 * order. Reading `col:first-of-type` instead would quietly measure whichever
 * column `COLUMN_META` happens to list first.
 */
function subjectWidth(): number {
  const headers = Array.from(document.querySelectorAll("th[aria-label]"));
  const index = headers.findIndex(
    (th) => th.getAttribute("aria-label") === "Subject",
  );
  if (index < 0) throw new Error("no Subject column header");
  const col = document.querySelectorAll("col")[index];
  if (!col) throw new Error("table did not render a colgroup");
  return parseFloat((col as HTMLElement).style.width);
}

function resizeHandle(): HTMLElement {
  return screen.getByRole("separator", { name: "Resize Subject column" });
}

function mouseEvent(type: string, clientX: number) {
  return new MouseEvent(type, { bubbles: true, clientX, clientY: 0 });
}

/**
 * The gesture as a list of steps, so each test decides where React flushes and
 * nothing else varies between them. Two moves, as the E2E does — one jump can
 * be coalesced. `document` rather than the handle because that is where
 * TanStack registers its listeners.
 */
function dragSteps(
  handle: HTMLElement,
  from: number,
  dx: number,
): Array<() => void> {
  return [
    () => void handle.dispatchEvent(mouseEvent("mousedown", from)),
    () => void document.dispatchEvent(mouseEvent("mousemove", from + dx / 2)),
    () => void document.dispatchEvent(mouseEvent("mousemove", from + dx)),
    () => void document.dispatchEvent(mouseEvent("mouseup", from + dx)),
  ];
}

const DRAG_FROM = 500;
const DRAG_BY = 60;

describe("TicketsTable column resizing", () => {
  it("applies the whole drag when React flushes between each event", () => {
    mount();
    const before = subjectWidth();

    for (const step of dragSteps(resizeHandle(), DRAG_FROM, DRAG_BY)) {
      act(step);
    }

    expect(subjectWidth()).toBe(before + DRAG_BY);
  });

  it("applies the whole drag when the events are batched into one render", () => {
    mount();
    const before = subjectWidth();
    const steps = dragSteps(resizeHandle(), DRAG_FROM, DRAG_BY);

    act(() => steps.forEach((step) => step()));

    expect(subjectWidth()).toBe(before + DRAG_BY);
  });

  it("applies the whole drag with an update already pending on the table", () => {
    mount();
    const before = subjectWidth();
    const handle = resizeHandle();
    const steps = dragSteps(handle, DRAG_FROM, DRAG_BY);

    // An arrow-key nudge is the one column-sizing update a test can queue from
    // outside; on CI the pending update was an unrelated re-render, but the
    // fiber state the drag then meets is the same one.
    act(() => {
      handle.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
      steps.forEach((step) => step());
    });

    // The drag starts from the size it grabbed, so it overwrites the nudge
    // rather than adding to it — +60 from `before`, not +76.
    expect(subjectWidth()).toBe(before + DRAG_BY);
  });
});
