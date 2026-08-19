# Ingestion has a single owner

Every ticket enters the desk through one module. Dedupe by message id, the
parent lookup that threads a reply onto an existing ticket, the reopen rule, and
creating a ticket together with the classification that follows it are one body
of behaviour, and two copies of it would disagree the first time one was
changed.

## Consequences

Anything that needs to create a ticket calls ingestion — it does not write the
rows itself. The pipeline simulator was written this way deliberately: a second
copy of the logic would make the pipeline page a demonstration of the copy
rather than of the desk, which is the entire reason the page is worth having.
