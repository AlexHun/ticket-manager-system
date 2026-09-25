# PRD: One-click demo session

**Status:** Draft · **Author:** Aleksei Hunich · **Date:** 2026-09-25

## Problem

Production is a showcase with no real customers, shown to HR and clients. Today a
visitor can only get in with a login the owner makes by hand: an invitation
created under Users, its link copied off `/outbox`, a password set in a private
window, then the credentials sent over. Each new visitor costs the owner that
procedure. A shared login instead ends up with a password in someone's email, and
the seed deliberately refuses to leave one on a deployed database. Most
visitors will spend a few minutes at most, and a login form is where they give up.

## Users

**A demo visitor:** HR, a hiring manager or a client, not a colleague. They are not
`admin` or `agent` in the domain sense and hold no account; they want to see what
the product does, AI features included, in one sitting.

**The owner** (the deployment's `admin`): wants to hand out one URL, stop
creating accounts per visitor, and not wake up to a surprise AI bill or a
defaced knowledge base.

## Success metrics

| Metric                                               | Today | Target                |
| ---------------------------------------------------- | ----- | --------------------- |
| Demo sessions started per week                       | 0     | TBD — needs the owner |
| Share of demo sessions that open at least one ticket | n/a   | TBD — needs the owner |
| _Guardrail:_ AI spend by demo sessions per UTC day   | n/a   | ≤ $1.00               |

## Scope

### In this pass

| #   | Requirement                                                                                                                                                                                                                     | Priority |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| R1  | While demo mode is on, the login page shows a "Use demo session" button; one click lands the visitor on the dashboard, signed in, without typing anything.                                                                      | Must     |
| R2  | While demo mode is off, the button is absent and every attempt to start a demo session is refused. Turning it off also ends every open demo session within 60 seconds.                                                          | Must     |
| R3  | A demo session sees every screen an admin sees except Users and Outbox. Neither appears in the navigation, and reaching either by link or typed URL shows the not-found page, and the API refuses their data to a demo session. | Must     |
| R4  | A demo session can do to a ticket everything an admin can: reply, change status and category, reassign, polish and summarise.                                                                                                   | Must     |
| R5  | Knowledge articles, automation settings, eval schedules and tutorial copy are viewable but not changeable in a demo session; their save controls are disabled with a note saying why.                                           | Must     |
| R6  | Every night, demo tickets return to their seeded state and any ticket a demo session created is removed; tickets that neither the seed nor a demo session created are untouched.                                                | Must     |
| R7  | A demo session ends 2 hours after it started; the visitor lands back on the login page with the button still there.                                                                                                             | Must     |
| R8  | Once the estimated AI spend of all demo sessions reaches $1.00 in a UTC day, AI actions in demo sessions show "demo AI limit reached, resets at 00:00 UTC" and make no call; admins' AI features are unaffected.                | Must     |
| R9  | One IP address can start at most 5 demo sessions per hour; the sixth attempt shows "try again later" and starts nothing.                                                                                                        | Must     |
| R10 | No outbound email created in a demo session is ever delivered, whether or not a mail provider is bound.                                                                                                                         | Must     |
| R11 | Every action a demo session takes is attributed in ticket history and the activity log to an identity visibly labelled as the demo, never to a real user.                                                                       | Must     |
| R12 | Every new demo session starts as a first-time user: walkthroughs, new-feature and changelog notices show as unseen and the dashboard has its default layout, whatever earlier demo sessions did.                                | Must     |
| R13 | Throughout a demo session a banner says this is a demo, that data resets nightly, and offers "Exit demo".                                                                                                                       | Should   |
| R14 | The admin can see demo sessions started per week and how many of them opened at least one ticket.                                                                                                                               | Should   |
| R15 | Evals are read-only in a demo session: a visitor can browse every past run and its results but cannot start, cancel or reschedule a run. The nightly reset leaves eval runs and results untouched.                              | Must     |

### Non-goals

- **A private copy of the data per visitor.** Tickets are global. Visitors in the
  same day see each other's changes, and the nightly reset is the answer to that.
- **CAPTCHA or any third-party challenge.** Rate limiting (R9) only for now.
- **A manual "reset now" button.** Before an important demo,
  `db:seed:tickets --reset` already does this by hand.
- **Turning a demo session into a real account.** Sign-up stays disabled
  (ADR-0010).
- **Removing the hand-made demo login** that PR #316 documents in
  `DEPLOYMENT.md` §5. It stays until this ships; retiring it is a docs
  follow-up.

## Constraints

- **Showcase only.** Demo mode is allowed only while production takes no real
  customer mail, the same condition `SCRIPTS.md` puts on `db:seed:tickets`. R2
  is the off switch for the day that changes.
- **The demo is not the assistant.** ADR-0002 keeps the automated account
  un-signable-in, and the `sendResetPassword` guard in ADR-0011 depends on that.
  The demo identity must be something else.
- **No password is created for the demo.** It must not become a credential that
  somebody other than its owner knows (ADR-0011) or a published-password account
  on a deployed database (`seed.ts`).
- **Auto-reply safety checks still apply** to anything a demo session triggers
  (ADR-0004). The spend cap stops calls; it never bypasses a check.
- **A demo visitor is a stranger.** Text typed into the pipeline simulator or a
  reply falls under `security.md`, not the trust given to an admin.
- **No ADR covers this yet.** This is the first way into production without a
  credential, so record the decision in an ADR when it ships.

## Risks

| Risk                                                                               | Impact                                          | Mitigation                                                                                       |
| ---------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| A visitor writes something offensive into a shared ticket before the next reset    | The next visitor, possibly a recruiter, sees it | Nightly reset (R6); `db:seed:tickets --reset` by hand before a key demo                          |
| Eval results age, because scheduled runs are paused while production is a showcase | A visitor sees runs dated weeks back            | Accepted: the runs show what the harness measures; the owner can resume the schedule at any time |
| Prompt injection through the pipeline simulator                                    | Model output misbehaves in front of a visitor   | Output checks unchanged (ADR-0004); nothing is delivered (R10)                                   |
| Demo mode left on after real customers arrive                                      | Strangers read real customer mail               | R2 off switch; showcase rule in `SCRIPTS.md`; the ADR names the trigger                          |
| Visitors' changes skew `/pipeline` and dashboard figures during the day            | Numbers look odd mid-day                        | Accepted: all tickets are demo data; reset nightly                                               |

## Open questions

- [ ] Target numbers for demo sessions per week and the open-a-ticket share. Needs
      the owner.
- [x] **Decided:** admin configuration is read-only in a demo session (R5), so a
      nightly reset never has to undo the owner's knowledge-base and automation
      edits.
- [x] **Decided:** 5 demo sessions per IP per hour (R9).
- [x] **Decided:** the reset and the AI-cap day both roll over at 00:00 UTC.
- [x] **Decided:** evals are read-only for demo sessions, which see every past run
      (R15). The owner pauses scheduled runs, so no new eval spend accrues; runs are
      not reset.
- [x] **Decided:** the cap counts only AI calls a demo session starts. Background
      classification of inbound mail is excluded; production receives none today.
