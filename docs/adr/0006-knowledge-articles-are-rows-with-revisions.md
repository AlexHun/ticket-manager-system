# Knowledge articles are rows with revisions, and are never deleted

The knowledge corpus was a checked-in markdown file, reviewable in a pull
request and beyond the reach of anyone who talked their way into an admin
session. It moved into the database so admins can edit it, on the one condition
the file itself set: it comes with an audit trail. Every write stores a full
revision with the editor's name denormalised onto it, so the trail survives the
account being deleted.

## Consequences

Articles archive rather than delete, because replies already in customers'
threads cite them by id and the database refuses the delete. There is no cache:
an edit that needed a restart to take effect is the worst possible failure for
this screen, so the corpus is read per answered ticket. The markdown file
remains only as the seed corpus for a fresh deployment and is not read at
runtime.
