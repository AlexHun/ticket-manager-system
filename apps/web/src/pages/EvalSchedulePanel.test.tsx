import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import {
  EVAL_CORPUS,
  EVAL_PLANNED_RUN_STATUS,
  type EvalPlannedRunRow,
  type EvalScheduleResponse,
} from "@ticket/shared";
import { apiStub } from "@/test/api-stub";
import { renderRoutes } from "@/test/render";
import { EvalSchedulePanel } from "./EvalSchedulePanel";

/**
 * When runs happen — the panel above the runs list (#236).
 *
 * Four things it is responsible for and nothing else is. The stored time is
 * what the field shows, so an admin is editing the arrangement in force rather
 * than a constant. **Pausing is confirmed, and the confirmation says that a run
 * already in flight is unaffected** — the one sentence this dialog exists for,
 * because an admin pausing at 03:50 is pausing *because* a run is going and the
 * honest answer is that nothing reaches it (`docs/adr/0021`). A planned run is
 * drawn as **upcoming and visibly not a run**. And re-timing is offered as
 * cancel-and-plan-again rather than as an edit, which is a copy decision and
 * therefore exactly the kind that only a test like this holds.
 */

vi.mock("@/lib/api", () => import("@/test/api-stub"));

const scheduleGet = apiStub.get("/api/evals/schedule");
const schedulePatch = apiStub.patch("/api/evals/schedule");
const plannedPost = apiStub.post("/api/evals/planned-runs");
const plannedDelete = apiStub.delete("/api/evals/planned-runs/:id");

function plannedRun(
  overrides: Partial<EvalPlannedRunRow> = {},
): EvalPlannedRunRow {
  return {
    id: 1,
    corpus: EVAL_CORPUS.live,
    runAt: "2099-01-02T14:00:00.000Z",
    status: EVAL_PLANNED_RUN_STATUS.planned,
    plannedByName: "Ada Admin",
    runId: null,
    ...overrides,
  };
}

function response(
  overrides: {
    evalConfigured?: boolean;
    schedule?: Partial<EvalScheduleResponse["schedule"]>;
    plannedRuns?: EvalPlannedRunRow[];
  } = {},
): { data: EvalScheduleResponse } {
  return {
    data: {
      evalConfigured: overrides.evalConfigured ?? true,
      schedule: {
        hour: 3,
        minute: 47,
        paused: false,
        updatedAt: "2026-09-11T09:00:00.000Z",
        updatedByName: "Ada Admin",
        ...overrides.schedule,
      },
      plannedRuns: overrides.plannedRuns ?? [],
    },
  };
}

function renderPanel() {
  return renderRoutes([{ path: "/", element: <EvalSchedulePanel /> }]);
}

beforeEach(() => {
  apiStub.reset();
  scheduleGet.mockResolvedValue(response());
  schedulePatch.mockResolvedValue({ data: {} });
  plannedPost.mockResolvedValue({ data: plannedRun() });
  plannedDelete.mockResolvedValue({ data: { ok: true } });
});

test("shows the stored time and who last changed it", async () => {
  renderPanel();

  // The arrangement in force, not the constant the sweep was written with —
  // which is the whole point of the time being a row.
  expect(await screen.findByLabelText(/time \(server clock\)/i)).toHaveValue(
    "03:47",
  );
  expect(await screen.findByText(/last changed by Ada Admin/i)).toBeVisible();
});

test("says so when nobody has ever changed it", async () => {
  scheduleGet.mockResolvedValue(
    response({ schedule: { updatedByName: null } }),
  );
  renderPanel();

  // "Last changed by —" would be a blank where a name goes; the seeded row has
  // no editor because nobody edited it, and that is a sentence rather than a
  // gap.
  expect(await screen.findByText(/never changed/i)).toBeVisible();
});

test("saves a retimed schedule", async () => {
  const user = userEvent.setup();
  renderPanel();

  const field = await screen.findByLabelText(/time \(server clock\)/i);
  await user.clear(field);
  await user.type(field, "05:15");
  await user.click(screen.getByRole("button", { name: /save time/i }));

  await waitFor(() => expect(schedulePatch).toHaveBeenCalledTimes(1));
  // Paused travels with the time on one write path, because pausing keeps the
  // time: two routes would leave a window where the row and the queue
  // disagreed about which edit happened last.
  expect(schedulePatch.mock.calls[0]?.[1]).toEqual({
    hour: 5,
    minute: 15,
    paused: false,
  });
});

test("pausing is confirmed, and the confirmation says a run in flight is unaffected", async () => {
  const user = userEvent.setup();
  renderPanel();

  await user.click(await screen.findByRole("button", { name: /^pause$/i }));

  const dialog = await screen.findByRole("dialog");
  // The sentence the dialog exists for. Without it an admin pausing at 03:50
  // reasonably believes this reaches tonight's run — and nothing does, because
  // a run that has started runs to completion.
  expect(within(dialog).getByText(/runs to completion/i)).toBeVisible();
  expect(
    within(dialog).getByText(/already under way is unaffected/i),
  ).toBeVisible();
  // And it keeps the time, which is the other half of what "pause" means here.
  expect(within(dialog).getByText(/keeps 03:47/i)).toBeVisible();

  await user.click(
    within(dialog).getByRole("button", { name: /pause schedule/i }),
  );

  await waitFor(() => expect(schedulePatch).toHaveBeenCalledTimes(1));
  expect(schedulePatch.mock.calls[0]?.[1]).toEqual({
    hour: 3,
    minute: 47,
    paused: true,
  });
});

test("resuming needs no confirmation", async () => {
  const user = userEvent.setup();
  scheduleGet.mockResolvedValue(response({ schedule: { paused: true } }));
  renderPanel();

  // It starts nothing now — it only lets the next night happen — so there is
  // nothing for a confirmation to warn about.
  await user.click(await screen.findByRole("button", { name: /resume/i }));

  await waitFor(() => expect(schedulePatch).toHaveBeenCalledTimes(1));
  expect(schedulePatch.mock.calls[0]?.[1]).toEqual({
    hour: 3,
    minute: 47,
    paused: false,
  });
});

test("draws a planned run as upcoming, not as a run", async () => {
  scheduleGet.mockResolvedValue(response({ plannedRuns: [plannedRun()] }));
  renderPanel();

  const row = await screen.findByRole("listitem");
  // A plan has measured nothing, so nothing about it may read as a
  // measurement: "Upcoming" is a claim about the future, where every badge on a
  // run card is a claim about what was measured (`docs/adr/0021`).
  expect(within(row).getByText(/upcoming/i)).toBeVisible();
  expect(within(row).getByText(/Live corpus/i)).toBeVisible();
  expect(within(row).getByText(/planned by Ada Admin/i)).toBeVisible();
});

test("a missed plan says it started nothing, and cannot be cancelled", async () => {
  scheduleGet.mockResolvedValue(
    response({
      plannedRuns: [
        plannedRun({ status: EVAL_PLANNED_RUN_STATUS.missed, id: 4 }),
      ],
    }),
  );
  renderPanel();

  const row = await screen.findByRole("listitem");
  expect(within(row).getByText(/missed/i)).toBeVisible();
  // The news it carries is "the run you expected did not happen, and it spent
  // nothing" — a row that merely vanished would read as one that fired.
  expect(within(row).getByText(/started nothing/i)).toBeVisible();
  expect(
    within(row).queryByRole("button", { name: /cancel/i }),
  ).not.toBeInTheDocument();
});

test("cancels a planned run", async () => {
  const user = userEvent.setup();
  scheduleGet.mockResolvedValue(
    response({ plannedRuns: [plannedRun({ id: 7 })] }),
  );
  renderPanel();

  await user.click(await screen.findByRole("button", { name: /cancel/i }));

  await waitFor(() => expect(plannedDelete).toHaveBeenCalledTimes(1));
  expect(plannedDelete.mock.calls[0]?.[0]).toBe("/api/evals/planned-runs/7");
});

test("offers re-timing as cancel and plan again", async () => {
  scheduleGet.mockResolvedValue(response({ plannedRuns: [plannedRun()] }));
  renderPanel();

  // Not an edit control, and the copy is where an admin learns that. One write
  // path means the row and the queued job can never disagree about when a plan
  // fires.
  expect(await screen.findByText(/cancel it and plan it again/i)).toBeVisible();
  expect(
    screen.queryByRole("button", { name: /re-?time|edit/i }),
  ).not.toBeInTheDocument();
});

test("plans a run at a picked time, against the chosen corpus", async () => {
  const user = userEvent.setup();
  renderPanel();

  // The date trigger is queried by its label, not by the words on it: a
  // `<label for>` pointing at a button *is* that button's accessible name, so
  // the trigger is named "Date" whatever it currently reads.
  await user.click(await screen.findByLabelText("Date"));
  // The day cell by its number, the way `ActivityPage.test.tsx` picks one:
  // react-day-picker names its day buttons with a full formatted date, so the
  // number is the text inside rather than the accessible name.
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const day = screen
    .getByText(String(tomorrow.getDate()), { selector: "[data-day]" })
    .closest("button");
  await user.click(day!);

  await user.type(screen.getByLabelText(/^time$/i), "14:30");

  await user.click(screen.getByLabelText(/corpus for this run/i));
  await user.click(screen.getByRole("option", { name: /live corpus/i }));

  await user.click(screen.getByRole("button", { name: /plan run/i }));

  await waitFor(() => expect(plannedPost).toHaveBeenCalledTimes(1));
  const body = plannedPost.mock.calls[0]?.[1] as {
    corpus: string;
    runAt: string;
  };
  // Either corpus, unlike the schedule: a named person picking Live for a
  // specific afternoon has chosen it.
  expect(body.corpus).toBe(EVAL_CORPUS.live);
  const at = new Date(body.runAt);
  expect(at.getHours()).toBe(14);
  expect(at.getMinutes()).toBe(30);
  expect(at.getTime()).toBeGreaterThan(Date.now());
});

test("cannot plan a run on a deployment with no key", async () => {
  scheduleGet.mockResolvedValue(
    response({ evalConfigured: false, plannedRuns: [] }),
  );
  renderPanel();

  // The same gate the Run button keeps: a control that always fails is worse
  // than one that is plainly unavailable.
  expect(
    await screen.findByRole("button", { name: /plan run/i }),
  ).toBeDisabled();
});
