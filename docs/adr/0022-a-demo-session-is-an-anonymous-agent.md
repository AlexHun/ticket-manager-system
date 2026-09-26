# A demo session is an anonymous agent

**This is the first way into production without a credential.** While demo mode
is on, one click of "Use demo session" on `/login` signs a visitor in as a
fresh identity. It is called "Demo visitor", holds the `agent` role and has no
password. Better Auth's `anonymous` plugin mints it, and nothing else in the app
changes to let it in: it is an agent, and it passes `requireAuth` like one.

Answered from [#319](https://github.com/AlexHun/ticket-manager-system/issues/319),
slice 1 of `docs/plans/demo-session.md`, from the PRD at
[`docs/prd/demo-session.md`](../prd/demo-session.md).

## Allowed only while production takes no real customer mail

Production is a showcase today. Every ticket on it is seeded demo data, the same
condition `SCRIPTS.md` puts on `db:seed:tickets`. A demo visitor reads and
changes those tickets, and replies to their customers. That is harmless only
while no customer on it is a real person.

**The trigger for turning it off is the first real customer email.** Before
production's inbound address is pointed at a real support inbox, or a real
customer is imported, `DEMO_MODE_ENABLED` is set to anything but `"true"`. After
that the button is absent and `/sign-in/anonymous` answers 403, and every demo
session already open is refused on its next request
([#324](https://github.com/AlexHun/ticket-manager-system/issues/324)). That is
sooner than the 60-second `cookieCache` window the plan allowed for: the refusal
is an `after` hook on `/get-session`, so it runs on an answer the cache served as
well as on one read from the database. A demo session also ends two hours after
it started, whatever the switch says. An event stream the page already has open
lives out its 15-minute lifetime, as it does for any revoked session
(`routes/events.ts`), but every event it delivers makes the page refetch, and
the refetch is refused.

**It also stays off on production until the plan's slices 1–7 have merged.**
Slice 1 ships the way in and nothing that bounds it: no AI budget, no per-IP
limit, no nightly reset, no 2-hour session, and demo replies still reach the
outbox like anyone's. Each later slice adds one of those.

## The decision

- **One switch, `DEMO_MODE_ENABLED`, default off.** Only the literal `"true"`
  turns it on, the same shape as `PIPELINE_SIMULATOR_ENABLED`. It lives in
  `apps/api/src/demo/mode.ts`, a leaf module with no imports, and is read per
  request. `GET /api/demo` reports it to the login page as a presence boolean,
  and that is the only thing the page is told.
- **The switch refuses the endpoint, not just the button.** The plugin creates
  a user on every call to `/sign-in/anonymous` **regardless of
  `disableSignUp`**. That was read in the installed 1.6.13 source
  (`dist/plugins/anonymous/index.mjs`), not assumed. So loading the plugin opens
  a public user-creation endpoint. A `before` hook in `auth.ts` refuses that path
  with 403 while demo mode is off. Hiding the button alone would leave the
  endpoint open to anyone with `curl`.
- **A demo identity is never `admin`.** The admin plugin serves its own
  `/api/auth/admin/*` endpoints (list and remove users, set roles, impersonate)
  to `adminRoles`, and none of them passes through `requireAdmin`. The demo keeps
  the plugin's `defaultRole`, `agent`. The admin screens R3 promises a visitor
  come from this repo's own guard, `requireAdminView`, keyed on `isAnonymous`
  and on reads only, never from the role
  ([#320](https://github.com/AlexHun/ticket-manager-system/issues/320)).
- **Every click is a new identity.** Walkthrough progress, the "new" badges, the
  changelog's seen flag and the dashboard layout are all stored per user, so a
  fresh row is a first-time user (R12) with no code of its own.
- **Every visitor has the same name, and is kept off every list of the
  people.** R11 asks that a visitor never be confused with a real user. So a
  demo identity is never offered as an assignee or named as the handoff target
  (`ASSIGNABLE_USER`, one predicate for both), never
  listed on the Users roster, and never drawn as a row on the desk-wide
  Workload panel. The assistant gets the first treatment too
  ([ADR-0002](./0002-the-assistant-is-an-account-not-a-role.md)).
- **No password is ever created for one.** It is not signed in with one, and
  `sendResetPassword` refuses it as it refuses the assistant. A visitor's
  placeholder address is in their own session, and `/request-password-reset` is
  public, so without that guard a stranger could mint a credential for an
  account anyone can already enter ([ADR-0011](./0011-nobody-types-somebody-elses-password.md)).
  The address sits under `demo.example.com`, reserved by RFC 2606. The plugin's
  default would have been under a real top-level domain.
- **A visitor cannot delete themselves.** The plugin ships
  `/delete-anonymous-user`, and a hook that deletes the demo identity when the
  same browser later signs in another way. Either would erase the identity a
  visitor's changes are filed under, leaving the trails naming nobody.
  `disableDeleteAnonymousUser` turns both off. Demo identities are removed by this
  repo's nightly reset (#323, `jobs/demo-reset.ts`) once their sessions have
  ended, not by a visitor.

## Considered Options

**A shared demo login** is what `DEPLOYMENT.md` §5 documents today: an invited
account whose password is sent to each visitor. It puts a password in somebody's
email, it is the published-password account `prisma/seed.ts` refuses to leave
on a deployed database, and every visitor shares one set of walkthrough flags.
Rejected.

**The assistant's account** is the one existing identity with no password.
ADR-0002 keeps it un-signable-in, and the `sendResetPassword` guard depends on
that. Rejected.

**Minting the session from a route in this repo** would avoid loading a plugin
at all. It means creating the user and signing the session cookie by hand,
which is Better Auth's job and a second copy of it. It stays the fallback if an
advisory ever reaches the `anonymous` plugin at the pinned version. The check at
1.6.13 found none, and is recorded in `docs/standards/backend.md`.

## Consequences

- `backend.md`'s pin note said the app loads `admin` and `emailAndPassword`
  only. It now names `anonymous` too, with the advisory check behind that.
- The E2E suite's ordinary API server runs with demo mode on (`.env.test`). The
  AI server runs with it off (`.env.test.ai`), and is where the refusal is
  asserted. No web server in the suite fronts a demo-off API, so the button's
  absence is a component test.
  - **Superseded by #321:** the demo AI budget needs a demo session on the one
    server that can reach a model, so the AI server runs with demo mode on too.
    No E2E server is demo-off now; the refusal is `routes/users.test.ts`'s,
    through the real `auth.handler`.
