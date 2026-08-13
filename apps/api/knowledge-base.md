# Support Knowledge Base

**Seed corpus, no longer live.** This file used to be read at boot and put
straight into the reply prompt. The articles now live in the `knowledge_article`
table, are edited at `/knowledge` by an admin, and carry an audit trail; nothing
reads this file at runtime. `bun run db:seed:kb` imports it into an empty
deployment, skipping any id the table already has — so re-running it can never
undo somebody's decision to withhold an article from the machine.

Keep it in step with the table by hand, or do not: it is the starting point and
the worked example of the format, not a mirror. What is still true is everything
below about *how to write an article*, because the table stores exactly the same
fields — with one improvement. `> Internal:` notes are their own column there
rather than lines a parser strips, so the guarantee that they never reach a model
is now "the corpus query does not select that column" rather than "a regex
removed them".

The business below is fictional: **Example Academy**, an online course platform
that sells individual courses, an all-access subscription and team licences.
Every address is on `example.com`, which is reserved by RFC 2606 and can never
belong to anyone, so a misconfigured test cannot email a real company. Replace
the whole thing for a real deployment — the format is the part worth keeping,
not the policies.

## Rules for the content

These exist because this file ends up inside a model prompt, next to text a
stranger emailed in.

1. **Every line may be quoted verbatim to a customer.** No credentials, no
   internal hostnames, no ticket or account numbers, no names of staff. Assume
   the whole file is one paraphrase away from an inbox.
2. **Internal guidance is marked `> Internal:` and is never quoted.** It tells an
   agent (or a drafting prompt) what *not* to promise and when to hand the ticket
   to a person. It is the one part of an article the customer must not see.
3. **Facts are specific and checkable.** "14 days" and "5–10 business days"
   can be compared against a draft; "promptly" cannot. A vague knowledge base
   cannot catch a model inventing a number, because there is nothing to disagree
   with.
4. **Categories are the four values in `TICKET_CATEGORY`** (`@ticket/shared`):
   General, Technical, Refund, Other. Same enum the classifier writes.
5. **Article ids are stable and never reused.** They are what
   `citedArticleIds` refers to. Ids do not encode the category — an article
   that gets re-categorised keeps its id.
6. **One question per article.** Retrieval and citation both get worse when an
   article answers three things.
7. **`Auto-reply: no` means a person answers this one.** The flag decides
   whether the article is put in front of the unattended auto-reply at all, so a
   `no` article can never appear in a reply nobody read. It is the control that
   lives in content rather than in code — a switch on `/knowledge` now, a `no`
   here — and it is deliberately the *first* gate rather than the last:
   everything downstream is a check on what a model produced, and this is the
   one that decides what it was ever asked.

   Say no whenever the honest answer needs a fact only a person can look up (has
   this customer actually been charged twice?), commits the company to spending
   money, or is really an escalation wearing an answer's clothing. Refund
   articles are `no` here *and* refused in code — `Refund` tickets are never
   auto-replied whatever this file says, so the two have to disagree before
   anything can go wrong.

## Trust

This is the only text in a draft-reply prompt that the support team wrote
itself. The customer's email sitting beside it is not, and the defences in
`apps/api/src/ai/polish.ts` and `classify.ts` exist for that reason.

The internal notes never reach the model. In the table they are a column of
their own that the corpus query does not select, so rule 2 above is enforced by
the shape of the query rather than by asking a prompt nicely not to quote them —
the auto-reply cannot leak what it was never shown. (In this file they are
`> Internal:` lines, and the importer moves them into that column.) That is also
why the notes can be blunt: they are for people.

Three consequences worth stating before someone builds on this:

- **Editing this content is a privileged action**, and it now has a screen.
  `/knowledge` is admin-only in the router and `requireAdmin` on every route in
  `apps/api/src/routes/knowledge.ts`; the frontend guard is UX, that middleware
  is the control. Whoever can edit an article can write into every draft-reply
  prompt the system will ever run, which is a strictly larger power than editing
  a document — so every write records who made it in the same transaction, and
  articles are archived rather than deleted, because replies already sent cite
  their ids. That audit trail is the condition on which this content was allowed
  to leave version control at all. A write path that skips it is not a bug in a
  feature; it is the feature's justification failing.
- **A policy here does not authorise a promise.** `inventedCommitments` compares
  a polished reply against *the agent's draft*, not against this file, so a draft
  that never mentioned a refund cannot acquire one during polishing even where
  the article says the customer is owed it. That is deliberate. The knowledge
  base tells an agent what is true; the agent still has to write it.
- **The auto-reply may only say what a cited article says.** Its output is
  checked against the text of the articles it cited: money words, links and email
  addresses that appear in the reply but in none of them cause the whole reply to
  be thrown away and the ticket handed to a person. So an article is not just a
  source here, it is the *permission* — which is the other reason to keep the
  facts specific. A vague article authorises vague replies.

---

## Account and sign-in

### KB-001 — I forgot my password

**Category:** Technical · **Auto-reply:** yes

Use **Forgot password?** on the sign-in page. The reset link is valid for 60
minutes and works once; requesting a new one invalidates any earlier link. If
nothing arrives, check the spam folder and confirm the address is the one the
account was created with — the platform sends no reply to an address it does not
recognise, which is the usual cause of "the email never came".

### KB-002 — The reset link says it has expired

**Category:** Technical · **Auto-reply:** yes

Links expire 60 minutes after they are issued and are single-use, so an expired
link usually means either an hour passed or a newer link was requested and it
superseded this one. Request a fresh link and use the most recent email.

### KB-003 — I can't sign in and my password is definitely right

**Category:** Technical · **Auto-reply:** yes

Three things account for nearly all of these: the account is under a different
email address than the one being typed, the browser is autofilling an old
password, or the account was created through Google sign-in and has no password
at all. Try **Continue with Google**, and try an incognito window to rule out
autofill.

> Internal: after three failed attempts the account locks for 15 minutes. The
> lock clears on its own — do not tell a customer to wait "a while", tell them
> 15 minutes.

### KB-004 — How do I change the email address on my account?

**Category:** General · **Auto-reply:** yes

**Account → Profile → Email**. A confirmation goes to both the old and the new
address, and the change takes effect when the new one is confirmed. Course
purchases, progress and certificates all follow the account, not the address.

### KB-005 — I've lost my two-factor device

**Category:** Technical · **Auto-reply:** no

Two-factor uses a TOTP authenticator app, and eight single-use recovery codes
are issued when it is enabled — any one of them signs the account in, after
which two-factor can be reset from **Account → Security**.

> Internal: support cannot disable two-factor. A customer with no recovery codes
> has to go through identity verification; hand the ticket to a person and do not
> suggest in the reply that support could do it if asked nicely.

### KB-006 — Can I delete my account and my data?

**Category:** General · **Auto-reply:** no

Yes. Write to `privacy@example.com` from the account's own email address and the
account and its personal data are deleted within 30 days. A copy of the data can
be exported first, from the same address. Deletion is permanent: purchased
courses, progress and issued certificates go with it.

---

## Billing, refunds and cancellation

### KB-007 — Can I get a refund for a course?

**Category:** Refund · **Auto-reply:** no

Individual course purchases are refundable within **14 days** of purchase, as
long as less than **20%** of the course has been watched. Ask from
**Account → Purchases → Request a refund**, or reply to the ticket and an agent
will start it. Refunds return to the original payment method and take **5–10
business days** to appear.

> Internal: the 20% figure is on the purchase record — check it before agreeing.
> Outside the window it is a judgement call and goes to a person; do not refuse
> outright and do not approve in the same breath.

### KB-008 — I was charged twice

**Category:** Refund · **Auto-reply:** no

A duplicate charge is refunded in full, no questions and no 14-day window — it
is a billing error rather than a change of mind. The refund reaches the original
payment method in 5–10 business days.

> Internal: confirm two settled charges rather than one charge plus a pending
> authorisation. Bank holds look identical to the customer and disappear on their
> own within about a week.

### KB-009 — How do I cancel the all-access subscription?

**Category:** General · **Auto-reply:** yes

**Account → Billing → Cancel plan**. Access continues to the end of the period
already paid for, and the next charge does not happen. Nothing is deleted on
cancellation: progress and certificates stay, and any individually purchased
course is unaffected.

### KB-010 — Can I get money back for the part of the plan I didn't use?

**Category:** Refund · **Auto-reply:** no

Part-used periods are not refunded — cancelling stops the next charge and leaves
access running to the end of the current one. The exception is the first 14 days
of an annual plan's initial charge, which is refundable in full.

### KB-011 — I cancelled but I was charged anyway

**Category:** Refund · **Auto-reply:** no

If the charge landed after the cancellation was confirmed it is refunded in full.
The common near-miss is a cancellation made *during* the renewal — the charge is
already in flight and lands anyway.

> Internal: check the cancellation timestamp against the charge. If cancellation
> came first, refund it without argument; the customer did what was asked of them.

### KB-012 — Where are my invoices?

**Category:** General · **Auto-reply:** yes

**Account → Billing → Invoices**, as a PDF per charge. A VAT number and company
address can be added in the same place and appear on every invoice issued
afterwards.

### KB-013 — Can you reissue an invoice with our VAT number on it?

**Category:** General · **Auto-reply:** no

Yes, once per invoice. Add the VAT number and company address under
**Account → Billing** first, then reply with the invoice number and a corrected
copy follows within two business days.

### KB-014 — Do you offer a student discount?

**Category:** General · **Auto-reply:** no

Yes — 40% off individual courses and the annual plan, on verification of a
current student email address or enrolment document. It does not stack with sale
pricing, and the lower of the two applies. Regional pricing is applied
automatically from the billing country and needs no code.

### KB-015 — Can I buy a course as a gift?

**Category:** General · **Auto-reply:** yes

Yes, from any course page: **Gift this course**. A code goes to the recipient's
email address (or back to the buyer, to pass on) and is valid for 12 months.
Unredeemed gift codes fall under the ordinary 14-day refund window.

---

## Courses and access

### KB-016 — How long do I have access to a course I bought?

**Category:** General · **Auto-reply:** yes

Individually purchased courses do not expire — access is for the lifetime of the
account, including every later update to the course. Access through the
all-access subscription lasts as long as the subscription does.

### KB-017 — A course I bought has been updated. Do I pay again?

**Category:** General · **Auto-reply:** yes

No. Updates to a purchased course are free forever, and new lessons appear in the
existing course. Materially different follow-up courses are sold separately and
are always announced as new courses, not updates.

### KB-018 — How do I get my certificate?

**Category:** General · **Auto-reply:** yes

A certificate is issued at 100% completion and is available as a PDF from
**Account → Certificates**, with a public verification link that can go on a CV
or a LinkedIn profile.

### KB-019 — I finished the course but there's no certificate

**Category:** Technical · **Auto-reply:** no

Completion counts lessons, not watch time, and the usual cause is a lesson that
was never marked complete — often a short one at the end of a section, or a
quiz. The course page lists any lesson still outstanding.

> Internal: if every lesson shows complete and no certificate exists, it is a
> genuine bug rather than a policy question. Escalate with the account email and
> the course.

### KB-020 — Are there subtitles?

**Category:** General · **Auto-reply:** yes

Every course has English subtitles. Machine-generated subtitles are available in
eight further languages, and a small number of courses have human-reviewed
translations, marked on the course page. Subtitles are chosen from the player.

### KB-021 — Can I download the videos?

**Category:** Technical · **Auto-reply:** yes

Offline downloads are a mobile app feature and need an active all-access
subscription. Downloads live in the app, expire 30 days after they are last
opened, and cannot be exported. Exercise files and code samples download from
the web as a ZIP per lesson, with no restriction.

---

## Platform and technical

### KB-022 — The video won't play or keeps buffering

**Category:** Technical · **Auto-reply:** yes

Most playback problems are local: try a different browser, disable extensions
(ad blockers and privacy extensions are the frequent culprits), and drop the
quality setting in the player. On a corporate network, streaming is sometimes
blocked outright.

> Internal: if it fails in two browsers on two networks, collect browser, OS and
> any console errors and escalate. Do not promise a fix date.

### KB-023 — My progress isn't being saved

**Category:** Technical · **Auto-reply:** yes

Progress saves every few seconds to the account, so it survives closing the tab
but not being signed out — a session that ended mid-lesson is the usual
explanation, and blocked third-party cookies or a private window is the usual
cause of that. Signing in again and replaying briefly restores the mark.

### KB-024 — Which devices does the app support?

**Category:** Technical · **Auto-reply:** yes

iOS 16 and later, Android 10 and later, and any current desktop browser. The
same account works on all of them at once; there is no device limit.

### KB-025 — How do I join the community forum?

**Category:** General · **Auto-reply:** yes

The forum uses the same account — sign in at the **Community** link in the
header, no separate registration. It is moderated, and posting requires at least
one purchased course or an active subscription.

---

## Teams

### KB-026 — How do team licences work?

**Category:** General · **Auto-reply:** yes

Team licences start at 5 seats and give every seat holder full all-access.
A team admin invites people by email from the team dashboard, and a seat can be
reassigned to a different person once every 30 days. Billing is annual, on one
invoice.

### KB-027 — Can I add seats mid-term?

**Category:** General · **Auto-reply:** no

Yes. Extra seats are charged pro rata to the end of the current term and are
available immediately. Seats cannot be removed mid-term; reduce the count at
renewal.

---

## Everything else

### KB-028 — I'd like to suggest a feature

**Category:** Other · **Auto-reply:** yes

Feature requests go to the **Ideas** board on the community forum, where they
can be voted on and where the product team reads them.

> Internal: thank them and point at the board. Never give a timeline, an estimate
> or a "the team is looking at it" — those come back as promises.

### KB-029 — Partnership, press or sponsorship

**Category:** Other · **Auto-reply:** yes

Press enquiries go to `press@example.com`; partnership and sponsorship enquiries
to `partners@example.com`. Support cannot forward these internally, so the
enquiry has to be sent to the right address to be seen.

### KB-030 — Do you have an affiliate programme?

**Category:** Other · **Auto-reply:** yes

Yes — 20% of a referred customer's first purchase, with a 60-day attribution
window. Applications are at `example.com/affiliates` and are reviewed within five
business days.

### KB-031 — I'm applying for a job

**Category:** Other · **Auto-reply:** yes

Open roles are at `example.com/careers` and applications are only accepted
through that page. Support cannot pass a CV to the hiring team.

---

## Support hours

### KB-032 — When will someone answer, and is there a phone number?

**Category:** General · **Auto-reply:** yes

Support is staffed Monday to Friday, 09:00–17:00 CET, excluding public holidays.
The target for a first reply is one business day; refunds and billing corrections
are actioned within two business days of being agreed. There is no phone line —
email is the only support channel, so that every answer is written down.
