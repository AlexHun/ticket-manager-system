import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { MAX_MESSAGE_BODY_LENGTH } from "@ticket/shared";
import { renderWithQuery } from "@/test/render";
import { TicketReplyComposer } from "./TicketReplyComposer";

/**
 * The composer's AI half: Polish, Undo, and what the two do to the draft box.
 *
 * The composer is rendered on its own rather than through `TicketDetailPage` —
 * it takes a ticket id and nothing else, so the page's two GETs would be setup
 * for a component that doesn't read them.
 */

const mockPost = vi.fn();

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
    patch: vi.fn(),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

const POLISH_URL = "/api/ai/polish-reply";
const MESSAGES_URL = "/api/tickets/12/messages";

const DRAFT = "shipped fri, ur parcel is on the way";
const POLISHED = "Hi Marta,\n\nYour parcel shipped on Friday.\n\nThanks,\nAaron";

function replyBox(): HTMLTextAreaElement {
  return screen.getByRole("textbox", { name: "Reply" });
}

function polishButton(): HTMLElement {
  return screen.getByRole("button", { name: /^Polish/ });
}

function sendButton(): HTMLElement {
  return screen.getByRole("button", { name: /Send reply|Sending/ });
}

/** Axios shape, so `extractErrorMessage` finds the server's sentence. */
function makeAxiosError(status: number, message?: string) {
  return Object.assign(new Error("Request failed"), {
    isAxiosError: true,
    response: { status, data: message ? { error: message } : {} },
  });
}

/**
 * Answer each endpoint separately.
 *
 * A blanket `mockResolvedValue` would answer a send with a polish response,
 * which is a state the real API can't produce.
 */
function mockApi({
  polished,
  polishError,
  sendError,
}: {
  polished?: string;
  polishError?: unknown;
  sendError?: unknown;
} = {}) {
  mockPost.mockImplementation((url: string) => {
    if (url === POLISH_URL) {
      return polishError
        ? Promise.reject(polishError)
        : Promise.resolve({ data: { polished: polished ?? POLISHED } });
    }
    return sendError
      ? Promise.reject(sendError)
      : Promise.resolve({ data: { message: { id: 99, ticketId: 12 } } });
  });
}

function renderComposer() {
  renderWithQuery(<TicketReplyComposer ticketId={12} />);
  return userEvent.setup();
}

/** Fill the box in one event — `type` is per-keystroke and this file has no
 *  interest in what happens between them. */
function fillDraft(value: string): void {
  fireEvent.change(replyBox(), { target: { value } });
}

beforeEach(() => {
  mockPost.mockReset();
});

describe("TicketReplyComposer polish — when it can run", () => {
  test("holds Polish until there is something to polish", async () => {
    mockApi();
    renderComposer();

    expect(polishButton()).toBeDisabled();

    fillDraft(DRAFT);

    await waitFor(() => expect(polishButton()).toBeEnabled());
  });

  test("holds Send until there is something to send", async () => {
    mockApi();
    renderComposer();

    expect(sendButton()).toBeDisabled();

    fillDraft(DRAFT);

    await waitFor(() => expect(sendButton()).toBeEnabled());
  });

  test("counts a whitespace-only draft as nothing", async () => {
    mockApi();
    renderComposer();

    fillDraft("   \n  ");

    await waitFor(() => expect(polishButton()).toBeDisabled());
  });

  test("refuses a draft the endpoint would reject for length", async () => {
    mockApi();
    renderComposer();

    fillDraft("x".repeat(MAX_MESSAGE_BODY_LENGTH + 1));

    // Send stays available — the schema's message is what explains that case.
    await waitFor(() => expect(polishButton()).toBeDisabled());
    expect(sendButton()).toBeEnabled();
  });

  test("says why it is greyed out, which a disabled button cannot do alone", async () => {
    mockApi();
    const user = renderComposer();

    // The button is wrapped in a span precisely because a disabled shadcn Button
    // sets `pointer-events: none` and never fires the hover Radix listens for.
    await user.hover(polishButton().parentElement!);

    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Write a draft first",
    );
  });
});

describe("TicketReplyComposer polish — the round trip", () => {
  test("sends the trimmed draft and the ticket id, and nothing else", async () => {
    mockApi();
    const user = renderComposer();
    fillDraft(`  ${DRAFT}  `);

    await user.click(polishButton());

    // Exact match: the customer's message is deliberately not a field here. The
    // server reads it out of the thread, so no caller can choose what the model
    // is told the customer said.
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith(POLISH_URL, {
        draft: DRAFT,
        ticketId: 12,
      }),
    );
  });

  test("writes the rewrite into the box", async () => {
    mockApi();
    const user = renderComposer();
    fillDraft(DRAFT);

    await user.click(polishButton());

    await waitFor(() => expect(replyBox()).toHaveValue(POLISHED));
  });

  test("locks the box while the rewrite is in flight", async () => {
    let settle!: (value: unknown) => void;
    mockPost.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    const user = renderComposer();
    fillDraft(DRAFT);

    await user.click(polishButton());

    // The box is about to be overwritten; keystrokes typed into it in the
    // meantime would be thrown away.
    expect(await screen.findByRole("button", { name: "Polishing…" })).toBeDisabled();
    expect(replyBox()).toBeDisabled();
    expect(sendButton()).toBeDisabled();

    settle({ data: { polished: POLISHED } });

    await waitFor(() => expect(replyBox()).toBeEnabled());
  });

  test("keeps the draft and explains a rejected polish", async () => {
    mockApi({
      polishError: makeAxiosError(
        503,
        "Polishing is unavailable — the AI account is out of credit. Send your draft as it is.",
      ),
    });
    const user = renderComposer();
    fillDraft(DRAFT);

    await user.click(polishButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "the AI account is out of credit",
    );
    // The draft is the only copy of what was typed.
    expect(replyBox()).toHaveValue(DRAFT);
    expect(screen.queryByRole("button", { name: "Undo polish" })).toBeNull();
  });
});

describe("TicketReplyComposer polish — undo", () => {
  test("appears only after a polish, and puts the draft back", async () => {
    mockApi();
    const user = renderComposer();
    fillDraft(DRAFT);
    expect(screen.queryByRole("button", { name: "Undo polish" })).toBeNull();

    await user.click(polishButton());
    const undo = await screen.findByRole("button", { name: "Undo polish" });
    await user.click(undo);

    expect(replyBox()).toHaveValue(DRAFT);
    // One polish, one undo — there is nothing left to go back to.
    expect(screen.queryByRole("button", { name: "Undo polish" })).toBeNull();
  });

  test("restores what was polished, not what was typed first", async () => {
    mockApi();
    const user = renderComposer();
    fillDraft(DRAFT);
    await user.click(polishButton());
    await screen.findByRole("button", { name: "Undo polish" });

    // The agent edits the rewrite, then polishes that.
    fillDraft(`${POLISHED}\n\nPS: tracking updates tomorrow.`);
    mockApi({ polished: "A second rewrite." });
    await user.click(polishButton());
    await waitFor(() => expect(replyBox()).toHaveValue("A second rewrite."));

    await user.click(screen.getByRole("button", { name: "Undo polish" }));

    expect(replyBox()).toHaveValue(`${POLISHED}\n\nPS: tracking updates tomorrow.`);
  });

  test("goes away once the reply is sent", async () => {
    mockApi();
    const user = renderComposer();
    fillDraft(DRAFT);
    await user.click(polishButton());
    await screen.findByRole("button", { name: "Undo polish" });

    await user.click(sendButton());

    // Offering to put a draft back into a box that was cleared on purpose is a
    // trap.
    await waitFor(() => expect(replyBox()).toHaveValue(""));
    expect(screen.queryByRole("button", { name: "Undo polish" })).toBeNull();
    // Sent unedited, so the draft it came from is the same text that went out
    // — still worth recording, since #20 wants the pair even when the two agree.
    expect(mockPost).toHaveBeenCalledWith(MESSAGES_URL, {
      textBody: POLISHED,
      polishedDraft: POLISHED,
    });
  });
});

describe("TicketReplyComposer polish — the draft a send is compared against", () => {
  test("a reply never polished carries no polished draft", async () => {
    mockApi();
    const user = renderComposer();
    fillDraft(DRAFT);

    await user.click(sendButton());

    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith(MESSAGES_URL, { textBody: DRAFT }),
    );
  });

  test("a hand-edit after polishing is sent against the text Polish returned", async () => {
    mockApi();
    const user = renderComposer();
    fillDraft(DRAFT);
    await user.click(polishButton());
    await waitFor(() => expect(replyBox()).toHaveValue(POLISHED));

    const edited = `${POLISHED}\n\nPS: tracking updates tomorrow.`;
    fillDraft(edited);
    await user.click(sendButton());

    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith(MESSAGES_URL, {
        textBody: edited,
        polishedDraft: POLISHED,
      }),
    );
  });

  test("undoing a polish before sending carries no polished draft", async () => {
    mockApi();
    const user = renderComposer();
    fillDraft(DRAFT);
    await user.click(polishButton());
    await user.click(await screen.findByRole("button", { name: "Undo polish" }));

    await user.click(sendButton());

    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith(MESSAGES_URL, { textBody: DRAFT }),
    );
  });
});

describe("TicketReplyComposer polish — one alert at a time", () => {
  test("a new polish clears the failure the last send left behind", async () => {
    mockApi({ sendError: makeAxiosError(404, "Ticket not found") });
    const user = renderComposer();
    fillDraft(DRAFT);

    await user.click(sendButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Ticket not found");

    mockApi();
    await user.click(polishButton());

    // Whichever action ran last owns the alert — two `role="alert"` nodes on
    // screen at once is also a strict-mode failure for anything querying it.
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(replyBox()).toHaveValue(POLISHED);
  });

  test("a send failure replaces the polish failure before it", async () => {
    mockApi({
      polishError: makeAxiosError(502, "Polishing came back empty"),
      sendError: makeAxiosError(500, "Something broke"),
    });
    const user = renderComposer();
    fillDraft(DRAFT);

    await user.click(polishButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Polishing came back empty",
    );

    await user.click(sendButton());

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Something broke"),
    );
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });
});
