# Inbound email HTML is stored and never rendered

Arriving email keeps its HTML part in the database, and nothing ever serves it.
It is left out of the message selection and out of the wire type the thread is
built from, so a route that tried to send it would not compile. The desk renders
the plain-text part as text; a sender who wrote HTML only gets a placeholder.

## Considered Options

Sanitising and rendering it — a sanitiser plus a sandboxed iframe — was
rejected as a large amount of security-critical machinery for a small gain in
fidelity. It only comes back if rendering customer HTML becomes a real
requirement.

## Consequences

Do not reach for raw HTML injection anywhere in the thread, and do not hand-roll
a tag stripper to fake a plain-text part — that is exactly how this reopens. The
rule extends to prompts: the HTML part is never given to a model either.
