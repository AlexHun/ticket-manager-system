-- The tutorials' starter copy, reworded to the copy standard (#489).
--
-- `prisma/seed-tutorials.ts` skips every page that already has a row, so the
-- new wording in `src/tutorial-starter-content.ts` reaches a fresh install and
-- nothing already deployed. This brings a deployed page level with it.
--
-- Each statement rewrites one field, and only where it still holds the text
-- the seed wrote: a step is found by that text rather than by its position,
-- and a field an admin has edited in the tutorial editor no longer matches, so
-- it is left as they wrote it. Running this twice changes nothing the first
-- run did not. `updatedAt` and the byline are left alone — the editor's
-- "Updated … by" line names the last person who wrote the page, and this is
-- not one. No `TUTORIAL_PAGE_VERSIONS` bump goes with it: the steps are
-- reworded, not made wrong, so nobody who dismissed one needs to see it again.
--
-- `src/tutorial-wording-migration.test.ts` replays this file against rows
-- seeded with the old copy.

UPDATE "tutorial_content"
SET "steps" = (
  SELECT jsonb_agg(
    CASE WHEN step ->> 'body' = 'Search, status, category and assignee — combine them, or use the Mine/Unassigned shortcuts for your own queue.'
      THEN jsonb_set(step, '{body}', to_jsonb('Search, status, category and assignee — combine them, or use the Mine and Unassigned shortcuts for your own tickets or the ones nobody has taken.'::text))
      ELSE step
    END
    ORDER BY position
  )
  FROM jsonb_array_elements("steps") WITH ORDINALITY AS s(step, position)
)
WHERE "pageKey" = 'tickets'
  AND "steps" @> jsonb_build_array(jsonb_build_object('body', 'Search, status, category and assignee — combine them, or use the Mine/Unassigned shortcuts for your own queue.'::text));

UPDATE "tutorial_content"
SET "steps" = (
  SELECT jsonb_agg(
    CASE WHEN step ->> 'body' = 'Generate a fresh read of the ticket and its thread — sentiment, key points, and a suggested next step. Every click re-reads the conversation, so regenerate after a new reply comes in.'
      THEN jsonb_set(step, '{body}', to_jsonb('Generate a fresh read of the ticket and its thread — sentiment, key points, and a suggested next step. Every click re-reads the thread, so regenerate after a new reply comes in.'::text))
      ELSE step
    END
    ORDER BY position
  )
  FROM jsonb_array_elements("steps") WITH ORDINALITY AS s(step, position)
)
WHERE "pageKey" = 'ticketDetail'
  AND "steps" @> jsonb_build_array(jsonb_build_object('body', 'Generate a fresh read of the ticket and its thread — sentiment, key points, and a suggested next step. Every click re-reads the conversation, so regenerate after a new reply comes in.'::text));

UPDATE "tutorial_content"
SET "steps" = (
  SELECT jsonb_agg(
    CASE WHEN step ->> 'title' = 'The conversation'
      THEN jsonb_set(step, '{title}', to_jsonb('The thread'::text))
      ELSE step
    END
    ORDER BY position
  )
  FROM jsonb_array_elements("steps") WITH ORDINALITY AS s(step, position)
)
WHERE "pageKey" = 'ticketDetail'
  AND "steps" @> jsonb_build_array(jsonb_build_object('title', 'The conversation'::text));

UPDATE "tutorial_content"
SET "steps" = (
  SELECT jsonb_agg(
    CASE WHEN step ->> 'body' = 'Send a test email through the pipeline and watch it move through the rail in real time.'
      THEN jsonb_set(step, '{body}', to_jsonb('Send a simulated ticket and watch it move through the rail in real time.'::text))
      ELSE step
    END
    ORDER BY position
  )
  FROM jsonb_array_elements("steps") WITH ORDINALITY AS s(step, position)
)
WHERE "pageKey" = 'pipeline'
  AND "steps" @> jsonb_build_array(jsonb_build_object('body', 'Send a test email through the pipeline and watch it move through the rail in real time.'::text));

UPDATE "tutorial_content"
SET "steps" = (
  SELECT jsonb_agg(
    CASE WHEN step ->> 'body' = 'Invite a new admin or agent — they''ll get an email to set their password.'
      THEN jsonb_set(step, '{body}', to_jsonb('Invite a new agent — they''ll get an email to set their own password. To make them an admin, edit their account once it''s there.'::text))
      ELSE step
    END
    ORDER BY position
  )
  FROM jsonb_array_elements("steps") WITH ORDINALITY AS s(step, position)
)
WHERE "pageKey" = 'users'
  AND "steps" @> jsonb_build_array(jsonb_build_object('body', 'Invite a new admin or agent — they''ll get an email to set their password.'::text));

UPDATE "tutorial_content"
SET "title" = 'Every email the desk writes'
WHERE "pageKey" = 'outbox'
  AND "title" = 'Every email the desk sent';
