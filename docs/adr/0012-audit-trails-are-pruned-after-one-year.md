# Audit trails are pruned after one year

`TicketActivity`, `AdminActivity`, `AutomationSettingsRevision` and
`KnowledgeArticleRevision` have never had anything remove a row: each was built
to answer "what happened, and when" for as long as the deployment runs, and
nothing in their own tickets ([#46](https://github.com/AlexHun/ticket-manager-system/issues/46),
[#49](https://github.com/AlexHun/ticket-manager-system/issues/49),
[#50](https://github.com/AlexHun/ticket-manager-system/issues/50)) said
otherwise. #46 left the question open on purpose rather than guessing at a
number. The answer, decided here, is one year, uniformly, for storage hygiene
rather than any compliance mandate — there is no SOC2/GDPR/HIPAA requirement
driving this deployment, so there is no regulatory floor to design around.
"Keep forever" was the other legitimate answer and was rejected only because it
was not the one picked, not because it was wrong; a deployment with an actual
retention obligation should treat this ADR as superseded rather than stretch
the one-year constant to fit.

A `pg-boss` scheduled job, `prune-activity-trails` (`src/jobs/`), sweeps all
four tables daily, deleting rows past the one-year mark in batches — the same
select-then-delete-in-batches shape `prune-outbox.ts` already established for
the outbox, chosen for the same reason: the first sweep on a year-old
deployment is the big one, and an unbounded `DELETE` would hold locks for as
long as it took.

## Considered Options

**Per-table retention windows**, mirroring `RETENTION_MS` in
`prune-outbox.ts` (a `Record` keyed by kind, so a fifth kind is a compile
error until someone states its window). Rejected here: the outbox's rows are
genuinely different things — a live credential versus a delivery log for
correspondence stored elsewhere — and that difference is what earns each one
its own number. These four tables are the same thing four times: a log of who
changed what, and when. A single constant says that honestly; a `Record` with
four identical values would just be the same number typed four times, waiting
for someone to change one and not the others.

**No exceptions**, pruning every row older than the cutoff including the most
recent revision of an otherwise-untouched knowledge article. Rejected for
`KnowledgeArticleRevision` specifically:
[0006](./0006-knowledge-articles-are-rows-with-revisions.md) made articles
undeletable through the ORM by construction — the revision's own `Restrict`
relation cannot be satisfied once no revision names the article — and an
article that has not been edited in over a year would lose its *only*
revision to a blind sweep, silently reopening that hole. So this job keeps
each article's single most recent revision regardless of age (`prisma
groupBy` on `articleId`, `_max(id)`, then excludes those ids from the delete);
everything before it is still pruned on schedule. `TicketActivity`,
`AdminActivity` and `AutomationSettingsRevision` carry no analogous
constraint — nothing depends on any of them having a surviving row — so they
prune without exception.

## Consequences

**The knowledge-base citation trail thins with age.** A reply sent more than a
year ago cites an article by id, and if that article has been edited since,
the exact wording it was grounded in at send time is gone once its revision
ages out — only the current wording (or whichever revision is least than a
year old) remains. Accepted as the point of a hygiene-driven policy rather
than a compliance one: nothing here promises "reconstruct any historical
reply," only "the current state of the world plus a year of how it got here."

**A fourth prunable table is a one-line addition, not a schema change.** The
job takes each model's Prisma delegate and a `createdAt` cutoff; a future
audit trail joins the sweep by adding one function of the same shape, the way
`prune-outbox.ts`'s `pruneKind` already generalizes over its three
`OutboundEmailKind`s.

**Reversing this later costs nothing already written.** Raising or removing
the retention window is a constant edit and a restart — pg-boss's `schedule`
takes the new cron immediately — not a migration, because pruning was never
expressed as a schema constraint (no partition, no TTL column). The rows this
deletes are simply gone, though: unlike the outbox's `undeliverable` /
`failed` rows, which point at mail that never went anywhere, a pruned
activity row is the only copy of the fact it recorded.
