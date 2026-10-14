import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { OutboundEmailRow } from "@ticket/shared";
import { apiStub } from "@/test/api-stub";
import { renderRoutes } from "@/test/render";
import { OutboxPage } from "./OutboxPage";

vi.mock("@/lib/api", () => import("@/test/api-stub"));

const outboxGet = apiStub.get("/api/outbox");
const retryPost = apiStub.post("/api/outbox/:id/retry");

const failedReply: OutboundEmailRow = {
  id: 7,
  kind: "reply",
  status: "failed",
  toEmail: "sam@example.com",
  toName: "Sam Customer",
  subject: "Re: Cannot log in",
  textBody: "Hello Sam.",
  ticketId: 3,
  attempts: 4,
  lastError: "The provider refused it.",
  createdAt: "2026-10-01T09:00:00.000Z",
  sentAt: null,
};

/** Axios-shaped, as the shared instance rejects. */
function axiosError(status: number, data: unknown) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, data },
  });
}

function renderOutboxPage() {
  return renderRoutes([{ path: "/outbox", Component: OutboxPage }], {
    initialEntries: ["/outbox"],
  });
}

beforeEach(() => {
  apiStub.reset();
});

describe("OutboxPage", () => {
  test("a refused retry shows the API's reason, not a status code", async () => {
    outboxGet.mockResolvedValue({
      data: { total: 1, mailConfigured: true, emails: [failedReply] },
    });
    retryPost.mockRejectedValue(
      axiosError(409, {
        error: "Couldn't retry — that email is already queued to send.",
      }),
    );

    renderOutboxPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Try again" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Couldn't retry — that email is already queued to send.",
    );
    expect(alert).not.toHaveTextContent("status code");
  });

  test("a retry refused with no reason says what failed, without a status code", async () => {
    outboxGet.mockResolvedValue({
      data: { total: 1, mailConfigured: true, emails: [failedReply] },
    });
    retryPost.mockRejectedValue(axiosError(500, "<html>"));

    renderOutboxPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Try again" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't retry that email. Try again.");
    expect(alert).not.toHaveTextContent("status code");
  });

  test("a failed list load says what failed, without a status code", async () => {
    outboxGet.mockRejectedValue(axiosError(500, "<html>"));

    renderOutboxPage();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load the Outbox. Try again.");
    expect(alert).not.toHaveTextContent("status code");
  });

  test("the status filter names Undeliverable, and the demo's withheld state on its own", async () => {
    outboxGet.mockResolvedValue({
      data: { total: 0, mailConfigured: true, emails: [] },
    });

    renderOutboxPage();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("combobox", { name: "Filter by status" }),
    );

    const listbox = await screen.findByRole("listbox");
    expect(
      within(listbox).getByRole("option", { name: "Undeliverable" }),
    ).toBeInTheDocument();
    expect(
      within(listbox).getByRole("option", { name: "Withheld (demo)" }),
    ).toBeInTheDocument();
    expect(within(listbox).queryByText(/Not sent/)).not.toBeInTheDocument();
  });

  test("the retry in progress keeps its verb", async () => {
    outboxGet.mockResolvedValue({
      data: { total: 1, mailConfigured: true, emails: [failedReply] },
    });
    retryPost.mockReturnValue(new Promise(() => {}));

    renderOutboxPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Try again" }));

    expect(
      await screen.findByRole("button", { name: "Trying again…" }),
    ).toBeDisabled();
  });
});
