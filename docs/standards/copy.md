# Copy standards (UI text and outbound email)

Rules for every word a person reads: labels, buttons, headings, tooltips, placeholders, `aria-label`s, empty states, toasts, dialogs, error messages, tutorial steps and the emails the desk sends. Decided 2026-10-09 against an inventory of the app's UI text; every "seen in" and every quoted example of a defect below comes from it.

## Scope

**In scope:** every screen of the app, toasts, API error messages that reach the UI (through `extractErrorMessage` or a zod message from `@ticket/core`), tutorial steps, the How it works page, the welcome page, the invitation and reset emails, and the auto-reply's sign-off.

**Out of scope, on purpose:**

- **`/__dev` pages.** Developer tooling, and several of their strings are a contract that suites index by (`apps/web/src/dev/usage-copy.ts`, see [frontend.md](frontend.md)).
- **Changelog entries.** CI writes them from `feat`/`fix` commit subjects, so these rules bind a `feat`/`fix` subject as they bind a label, and an entry already recorded in `packages/shared/src/changelog-entries.json` is history and is left as it was.
- **Seeded tickets and knowledge articles.** They are written as customers write, and a customer's typo there is realistic.
- **Text sent to a model.** Prompts are governed by [ai-features.md](ai-features.md) and [security-auto-reply.md](security-auto-reply.md); rewording one for style changes measured behaviour.

## Vocabulary

**The glossary in `CONTEXT.md` binds the UI.** A screen names a domain thing by its glossary term, and a word from a term's _Avoid_ list in UI text is a defect, not a style choice. The inventory found the same few drifting again and again:

| Write                         | Not                                | Seen in                                                          |
| ----------------------------- | ---------------------------------- | ---------------------------------------------------------------- |
| Backlog, or "the ticket list" | queue, Queues                      | sidebar heading, handoff options, tickets tutorial, How it works |
| thread                        | conversation, conversation history | summary panel, ticket-detail tutorial, lifecycle                 |
| a person                      | a human                            | Activity feed                                                    |
| handoff, hand off             | escalate, escalation               | knowledge article placeholder                                    |
| simulated ticket              | test email, test ticket            | pipeline tutorial                                                |
| Undeliverable                 | Not sent, unsent                   | Outbox status filter                                             |

"Failed" stays only for an email the mail provider actually refused, which is a different delivery from Undeliverable. A demo session's withheld email is a third state and keeps a label of its own; it is not Undeliverable either.

**"queue" stays for a background job's queue** ("Queued, or being classified now", "the queue of jobs"), so a reviewer does not flag it: that is pg-boss's queue, a thing no glossary term names, and rewording it would trade an accurate word for a vaguer one. The glossary's senses stay banned — the Backlog, the Outbox and a Planned run are never a queue.

- **The people who sign in are the Team.** The admin screen that lists them is **Team**, not Users; a person on it is a **team member**, and the record they sign in with is their **account**. "user" does not appear in UI text. The route path is not copy and does not have to change with the label.
- **A Customer is never a user, requester or client**, and an Agent is never an operator.
- **The product is `BRAND_NAME`** ("The Great Forge Desk", in `@ticket/shared`) wherever a sentence names it; `BRAND_SHORT` only where space is tight. Not "the support desk", not "the system" in a sentence that means the product.
- **Statuses keep their capital** as proper names of a state: New, Processing, Open, Resolved, Closed. A status word used as an ordinary adjective in running prose is lower case ("3 open tickets", meaning 3 in Open) — the capital marks the state, not the word. That adjective never stands for the Backlog: the Backlog is New and Open together, so a count of it is "Backlog" or "the ticket list". "Open tickets" for the Backlog is on the glossary's _Avoid_ list, and it reads as excluding every New ticket.
- Machine-written work is the **assistant's**. Not "the bot", not "AI" as a noun for the actor; "AI summary" and "AI polish" are feature names and stay.

## Spelling and mechanics

- **British English.** The UI already is ("Uncategorised", "Summarise", "cancelled", "centre"); the inventory found the dashboard's "Customize" and "Done customizing" and the tutorial editor's "centered". -ise, not -ize; -our, -re, -ll- ("cancelled", "labelled").
- **Sentence case everywhere** — buttons, headings, tabs, menu items, dialog titles, column headers: "Send reply", "Knowledge base", "Planned runs". Only proper names and the statuses above take capitals. **A glossary term in prose is not a proper name**: on the How it works page it is "handoff", "revision" and "the nightly reset", not "Handoff" or "The Nightly reset"; statuses, `BRAND_NAME` and named features ("AI summary", "AI polish") keep theirs. A capital on every glossary word would make the statuses' capital mean nothing.
- **A button is a verb and its object**: "Save changes", "Archive article", "Send reset link". A bare verb is fine where the object is the whole surface ("Save" in a one-field form, "Next" in a stepper).
- **A button in progress keeps its verb and ends in a single ellipsis character**: "Saving…", "Sending…" — `…`, not three dots.
- **A toast reports what happened, in the past tense, without a "successfully"**: "Draft polished", "Schedule paused".
- **Plurals agree with the number.** Write both forms (`n === 1 ? "ticket" : "tickets"`); never append a bare `s` to a word whose plural is not just `s`, and never print "1 tickets".
- **Dashes:** an em dash with a space each side ( — ) joins two clauses, as the UI already does; an en dash with no spaces marks a range ("3–7 days", "1–4h"), full dates included ("9–12 Oct 2026", "30 Sep–2 Oct 2026"), with each shared part written once — one range mark whatever its ends are, rather than a second rule for dates.
- **Dates are British order**: "9 Oct 2026", not "Oct 9, 2026" — the spelling is British, and a US-order date beside it reads as a different locale's leftover. Seen in: the Activity date filter (`apps/web/src/pages/ActivityFilters.tsx`), whose US-order range is also joined by a spaced dash.
- **Numbers** are digits in UI chrome ("Page 2 of 5", "24 hours"); prose may spell a small count out ("five times each") when that reads better.

## Errors and empty states

**An error says what failed, then what to do about it**, in that order: "Couldn't load tickets. Try again." The inventory had two shapes side by side ("Failed to load tickets" and "Couldn't load the list of users.") — the second is the one. Where there is nothing the reader can do, the error stops after the first half; where the remedy is specific, it names it ("Ask an admin to send you another.").

- Start with "Couldn't", not "Failed to", "Error:" or "Oops".
- **A fallback passed to `extractErrorMessage` follows the same shape**, because it is what the reader sees whenever the API sends no message.
- **An API or validation message that reaches the UI is copy.** Same shape, same vocabulary, and it **ends in a full stop** ("You cannot approve your own revision.", not "Article not found"), as the "Couldn't load tickets. Try again." shape does — the reader sees it as a sentence beside sentences.
- **Exempt: a message only a hand-edited URL, a server-populated picker or a broken client can produce.** That is "Invalid page size" and the other query-parameter messages, and the body and path checks behind controls that only offer valid values: "Invalid request", "Invalid assignee", "Invalid status", the dashboard-layout checks (`packages/core/src/schemas/dashboard.ts`) and the checks on an uploaded case file (`packages/core/src/schemas/evals.ts`, "Two cases share an id"). No reader who uses the app as built ever sees one, so rewording them churns tests for nobody; one a person can reach by typing is copy again.
- No status codes or `err.message` in the sentence a person reads (the Team page's load error appended one until #481).
- **An empty state says what will fill it**, not only that it is empty: "Nothing here yet. Emails appear as the desk writes them." Not jokes ("Inbox zero").
- **A destructive dialog says what will happen, not "Are you sure?"**: "Delete Ana Silva? Their sessions end and they leave the Team list."

## Outbound email

The invitation and reset emails (`apps/api/src/auth.ts`) and the auto-reply's sign-off are the only copy that reaches someone outside the app.

- They name the product and sign off as it — "The Great Forge Desk", not "the support desk" and "The Support Team" — and so does the auto-reply's sign off (`composeReply` in `apps/api/src/ai/auto-reply.ts`). **`BRAND_NAME` and `BRAND_SHORT` live in `@ticket/shared`** since #488, the one module the web app, the API and the E2E suite can all import, so nobody restates the literal; the web app's own brand module, which the API could not reach, is gone.
- Subject lines say what the email is for, in sentence case: "Your Great Forge Desk account is ready", "Reset your Great Forge Desk password". Where the name stands before a noun it drops its article, derived from `BRAND_NAME` in `auth.ts` rather than retyped.

## Changing copy safely

- **Tests read copy.** Playwright `getByRole(…, { name })` and RTL text queries match on it, so a reworded label is a test change in the same commit. Playwright matches a name as a case-insensitive **substring**: a new name that contains another control's name puts the old query in strict-mode violation ([frontend.md](frontend.md) has the measured case).
- **A string that two suites share is a contract**, not a literal — `DEMO_READ_ONLY_NOTE` in `@ticket/shared` is the pattern. Reword it there and both suites follow.
- **Tutorial steps live in the database.** `apps/api/prisma/seed-tutorials.ts` skips every page that already has a row, so fixing a typo there changes new installs and nothing already deployed; a deployed wording is fixed in the admin editor on the Tutorials page too. Rewording a tutorial never needs a `TUTORIAL_PAGE_VERSIONS` bump; only a page change that makes the steps wrong does.
- **Review copy by area**, not repo-wide in one pass: one screen family per change keeps the test churn reviewable. The `copy-reviewer` agent in `.claude/agents/` reviews one area's inventory against this file and returns tagged findings with suggested text.
