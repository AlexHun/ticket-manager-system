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
 * and the column came back at the *exact* width it started at. So these assert
 * the full delta, not merely "wider": a partial application would be a
 * different bug, and `toBeGreaterThan` would wave both through.
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
 */
function subjectWidth(): number {
  const first = document.querySelector("col");
  if (!first) throw new Error("table did not render a colgroup");
  return parseFloat(first.style.width);
}

function resizeHandle(): HTMLElement {
  return screen.getByRole("separator", { name: "Resize Subject column" });
}

function mouseEvent(type: string, clientX: number) {
  return new MouseEvent(type, { bubbles: true, clientX, clientY: 0 });
}

/**
 * Two moves, as the E2E does — one jump can be coalesced. `document` rather
 * than the handle because that is where TanStack registers its listeners.
 */
function dragBy(handle: HTMLElement, from: number, dx: number) {
  handle.dispatchEvent(mouseEvent("mousedown", from));
  document.dispatchEvent(mouseEvent("mousemove", from + dx / 2));
  document.dispatchEvent(mouseEvent("mousemove", from + dx));
  document.dispatchEvent(mouseEvent("mouseup", from + dx));
}

describe("TicketsTable column resizing", () => {
  it("applies the whole drag when React flushes between each event", () => {
    mount();
    const before = subjectWidth();
    const handle = resizeHandle();

    act(() => void handle.dispatchEvent(mouseEvent("mousedown", 500)));
    act(() => void document.dispatchEvent(mouseEvent("mousemove", 530)));
    act(() => void document.dispatchEvent(mouseEvent("mousemove", 560)));
    act(() => void document.dispatchEvent(mouseEvent("mouseup", 560)));

    expect(subjectWidth()).toBe(before + 60);
  });

  it("applies the whole drag when the events are batched into one render", () => {
    mount();
    const before = subjectWidth();
    const handle = resizeHandle();

    act(() => dragBy(handle, 500, 60));

    expect(subjectWidth()).toBe(before + 60);
  });

  it("applies the whole drag with an update already pending on the table", () => {
    mount();
    const before = subjectWidth();
    const handle = resizeHandle();

    // An arrow-key nudge is the one column-sizing update a test can queue from
    // outside; on CI the pending update was an unrelated re-render, but the
    // fiber state the drag then meets is the same one.
    act(() => {
      handle.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
      dragBy(handle, 500, 60);
    });

    // The drag starts from the size it grabbed, so it overwrites the nudge
    // rather than adding to it — +60 from `before`, not +76.
    expect(subjectWidth()).toBe(before + 60);
  });
});
