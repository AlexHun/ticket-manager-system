# Background jobs run in the application database

Classification and auto-reply run as queued jobs on pg-boss, which keeps its
queue in the Postgres database the desk already has. The webhook that receives
an email must answer before a model is called — a mail provider times that
request out and retries it, and a retried webhook is duplicate ingestion — so
the work has to leave the request, and it has to survive a restart.

## Considered Options

Redis or a hosted queue was rejected as a second piece of infrastructure to run
and pay for; the project defers those until there is a concrete need. Doing the
work in-process without a queue was rejected because a crash loses it silently.

## Consequences

The ticket row is the source of truth and a job is only a nudge, so a job
delivered twice or replayed after a crash costs nothing — never replace that
guard with a check on job state. Two behaviours of the library are load-bearing
and were found by measurement: creating a queue does not update an existing one,
so queue settings must be applied explicitly on boot or every deployment past
the first silently keeps the old ones; and the queue's notification fires on
insert rather than when a retry becomes due, so the polling interval is what
decides how late a retry actually runs.
