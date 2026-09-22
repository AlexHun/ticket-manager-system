import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SpendTable } from "./SpendTable";
import {
  USAGE_DETAIL_LABEL,
  USAGE_FACETS,
  USAGE_FACET_KEYS,
  USAGE_SEARCH_LABEL,
  USAGE_TABLE_LABEL,
  VERDICT,
  type IssueUsage,
} from "./usage-protocol";
import { DEFAULT_USAGE_TABLE_VIEW, type UsageTableView } from "./usage-view";

/**
 * The table, mounted on its own — no page, no axios stub, no Scan (#288).
 *
 * **This file is deliberately short, and what is missing from it is the
 * point.** Which rows four controls leave, in what order, is `usage-view.ts`'s
 * question and is asked of made-up rows in `usage-view.test.ts`, where a filter
 * can be put to every row a scan could produce rather than to the three a
 * component happened to render. That the click reaches a real reading of real
 * transcripts is `dev-usage.spec.ts`'s, in a real browser. What is left here is
 * the narrow band between them: things that need a render to be true at all,
 * and that neither of those two can say.
 *
 * There are four, and each one is here because nothing else holds it:
 *
 * - the `aria-sort` *vocabulary* — the E2E asserts the active column's value,
 *   never the two that say something by saying nothing;
 * - the debounce, which has no timer to advance in a unit test and nothing to
 *   observe between keystrokes in a browser, where `fill` is atomic;
 * - the detail toggle calling `withDetail` — `usage-view.test.ts` holds the
 *   rule, and this is the one line that spends it;
 * - the filter bar's resting labels, which are what says a select at rest is
 *   narrowing nothing.
 *
 * `SpendTable` is controlled, so the harness below is the smallest thing that
 * makes it operable: the state it lifts to `UsagePage` in the app (#272's
 * measured decision — a mutation clears its `data` while it re-reads, so
 * anything kept in here is thrown away by the press of Scan) is held by a
 * `useState` here instead. Bare RTL `render` under a `TooltipProvider` and
 * nothing else, per `testing.md`: the table needs no router and no query
 * client, and providers a component does not use hide the fact that it does
 * not use them. `Hint` is what needs the one that is there.
 */

function makeIssue(over: Partial<IssueUsage> = {}): IssueUsage {
  return {
    issue: 101,
    spend: { out: 20_000, turns: 2, sessions: 1, cacheRead: 400_000 },
    title: "Ranking the table from its headers",
    url: "https://github.com/AlexHun/ticket-manager-system/issues/101",
    forecast: "M",
    bucket: "S",
    verdict: VERDICT.under,
    ...over,
  };
}

/**
 * Three rows whose output tokens and turns disagree, which is what makes a
 * sort on a detail column visibly not the sort the table opened on — and so
 * what makes the reset below visible when the column goes away.
 */
const ISSUES = [
  makeIssue(),
  makeIssue({
    issue: 102,
    spend: { out: 3_000, turns: 9, sessions: 4, cacheRead: 12_000 },
    title: "A second issue",
    url: "https://github.com/AlexHun/ticket-manager-system/issues/102",
    forecast: "S",
    verdict: VERDICT.onTarget,
  }),
  makeIssue({
    issue: 105,
    spend: { out: 90_000, turns: 1, sessions: 1, cacheRead: 250_000 },
    title: "An issue that came in over its band",
    url: "https://github.com/AlexHun/ticket-manager-system/issues/105",
    forecast: "S",
    bucket: "M",
    verdict: VERDICT.over,
  }),
];

/** Output tokens descending — the order the rows arrive in (#286). */
const ARRIVED = ["#105", "#101", "#102"];

function Harness({ issues }: { issues: IssueUsage[] }) {
  const [view, setView] = useState<UsageTableView>(DEFAULT_USAGE_TABLE_VIEW);
  return <SpendTable issues={issues} view={view} onViewChange={setView} />;
}

const mount = (issues: IssueUsage[] = ISSUES) =>
  render(
    <TooltipProvider>
      <Harness issues={issues} />
    </TooltipProvider>,
  );

/** The column header cell, which is where the direction is announced. */
const header = (name: string) =>
  screen.getByRole("columnheader", { name: new RegExp(`^${name}$`, "i") });

/** The rows on screen, by the issue each one is about. */
const issueOrder = () =>
  within(screen.getByRole("region", { name: USAGE_TABLE_LABEL }))
    .getAllByRole("rowheader")
    .map((cell) => cell.textContent);

const searchBox = () => screen.getByLabelText(USAGE_SEARCH_LABEL);

const detailToggle = () =>
  screen.getByRole("button", { name: USAGE_DETAIL_LABEL });

describe("SpendTable headers", () => {
  /**
   * The `aria-sort` vocabulary, which is three claims rather than one.
   *
   * The active column announces its direction; a column that ranks and is not
   * currently ranking says `none`; and **a column nothing ranks by carries no
   * `aria-sort` at all**, because `none` would advertise a control that is not
   * there. Only the first of the three is asserted in the browser, where the
   * click is what is being proved — the other two are the part a header can
   * get wrong while every row is in the right place.
   */
  test("announces the ranking column, and says nothing about one that cannot rank", () => {
    mount();

    expect(header("Output tokens")).toHaveAttribute("aria-sort", "descending");
    expect(header("Issue")).toHaveAttribute("aria-sort", "none");
    expect(header("Title")).not.toHaveAttribute("aria-sort");
  });

  /**
   * The one line that spends `withDetail` (#287).
   *
   * The rule itself — hiding a detail column while the table is ranked by it
   * returns the sort to the default — is asked of every detail column, without
   * a renderer, in `usage-view.test.ts`. What only a render can say is that the
   * toggle is wired to it, and that the outcome is a ranking the table can
   * still announce: `Turns` gone, `Output tokens` carrying the arrow back, and
   * the rows in the order they arrived in. A `withDetail` the toggle never
   * called would leave the rows ranked by a column with no header.
   */
  test("returns the ranking to the default when the column it ranked by is hidden", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(detailToggle());
    await user.click(screen.getByRole("button", { name: "Turns" }));
    expect(issueOrder()).toEqual(["#102", "#101", "#105"]);

    await user.click(detailToggle());

    expect(issueOrder()).toEqual(ARRIVED);
    expect(header("Output tokens")).toHaveAttribute("aria-sort", "descending");
    expect(screen.queryByRole("columnheader", { name: /turns/i })).toBeNull();
  });
});

describe("SpendTable filter bar", () => {
  /**
   * The debounce, proved rather than timed.
   *
   * Asserting "still three rows" straight after a real-timer `type()` would be
   * a race against the 150 ms the hook waits: it passes on an idle machine and
   * goes red under a loaded one, which is the flake `testing.md` records for
   * the tickets list. Under a fake clock the two states are separable — the
   * term is in the box and nothing has moved, and then the clock is what moves
   * it — so this is the one assertion anywhere that can say *why* the table
   * narrowed rather than only that it did. The browser cannot: Playwright's
   * `fill` puts the whole term in at once, and there is no keystroke to be
   * between.
   *
   * **`fireEvent`, not `userEvent`, and that is what makes it work at all.**
   * `userEvent` awaits between keystrokes through RTL's async wrapper, which
   * needs a clock that is running; under `vi.useFakeTimers()` the very first
   * `type()` never resolves, the test dies on Vitest's own 15 s timeout, and
   * the `finally` that would have restored the clock never runs — so every test
   * after it in the file times out too. A `change` event is synchronous, is
   * already wrapped in `act`, and is all this needs: nothing here is about how
   * the characters arrive, only about when the term is spent.
   */
  test("filters once the typing settles rather than on every keystroke", () => {
    mount();

    vi.useFakeTimers();
    try {
      fireEvent.change(searchBox(), { target: { value: "102" } });

      expect(searchBox()).toHaveValue("102");
      expect(issueOrder()).toEqual(ARRIVED);

      // Generously past the debounce rather than exactly on it: what is being
      // held is that the clock has to move at all, not the length of the wait.
      act(() => {
        vi.advanceTimersByTime(1_000);
      });

      expect(issueOrder()).toEqual(["#102"]);
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * Every select opens on its "any" row, which is the state the table opens in:
   * three controls that are present and narrowing nothing. That they narrow
   * nothing is `usage-view.test.ts`'s (`DEFAULT_USAGE_TABLE_VIEW` shows every
   * row); that each one *says* so is only visible in a render, and it is what
   * stops a developer reading an untouched bar as a filter already applied.
   */
  test("opens every facet at its any row", () => {
    mount();

    for (const key of USAGE_FACET_KEYS) {
      expect(
        screen.getByRole("combobox", { name: USAGE_FACETS[key].label }),
      ).toHaveTextContent(USAGE_FACETS[key].any);
    }
  });
});
