---
name: release
description: 'Release develop into main, which deploys production. Use when the user asks to release, ship to production, or merge develop (or "to main").'
---

# Release

One PR from `develop` into `main`, merged, and production watched until it
runs the release. Only when the user asks for it: their ask covers opening and
merging this one release, short of step 2's gate.

## Steps

1. **Scope.** `git fetch origin`, then, in its own call,
   `node .claude/scripts/release-scope.mjs`. It prints both versions, CI on
   develop's last commit that ran it, every PR merged since `main`, commits
   that reached `develop` outside a PR, and the deploy risks. Exit 1 is not
   ready: nothing to release, or that CI run is not green. Say which and stop;
   a run still going is waited on with `gh run watch <id> --compact
   --exit-status` and the script re-run. Done when it exits 0.
2. **Gate.** Read every migration and env template the script names.
   A migration that drops or renames a table or column, or a variable name a
   template gained, goes to the user with the file and line, and the release
   waits for their yes: a migration runs as the API's pre-deploy command and
   is a one-way door, and a new variable unset in Railway's production
   environment breaks the boot (`docs/standards/deployment.md`). Additive
   migrations, image and lockfile changes are named in the body and need
   nothing more.
3. **Body.** Write it to a scratchpad file:
   - `Release \`develop\` into \`main\`.` and the version, old to new;
   - the PRs, grouped by what production sees: **App** (`feat`, `fix`, and
     `refactor` under `apps/` that a user could notice), **Under the hood**
     (tests, refactors, lint and standards guards), **Agent tooling and docs**
     (`.claude/`, `docs/`, `CLAUDE.md`), one line each, `#<pr>: <what
     changed for the reader>`;
   - the script's CI line and every deploy risk it found, each with what it
     does on deploy;
   - `Merging redeploys Railway's production environment.`

   Done when every PR and commit the script listed appears exactly once:
   count the body's lines against the script's counts.
4. **Open.** `gh pr create --base main --head develop --title "Release:
   <the App changes in a phrase>" --body-file <file>`. Its checks are
   Railway's develop deploys, run on a `[skip ci]` version bump: they say
   nothing about the tests. Step 1's CI line is the test signal.
5. **Merge**, in its own call: `gh pr merge <n> --merge`, the repo's
   merge-commit style, and never `--delete-branch`, whose branch here is
   `develop`. No rule in `.claude/settings.json` allows it, on purpose: the
   user has the last word before production. Outside auto mode that is the
   permission prompt. In auto mode the classifier refuses the call outright
   (#672), so hand the user the command, `! gh pr merge <n> --merge`, with
   the PR link, and go on to step 6 once they say it is merged.
6. **Watch production.** Railway posts one commit status per service on the
   merge commit (`git rev-parse origin/main` after a fetch):

   ```
   do { Start-Sleep 30; $s = (gh api repos/AlexHun/ticket-manager-system/commits/<sha>/status | ConvertFrom-Json) } while ($s.state -eq 'pending'); $s.statuses | Select-Object context,state,description
   ```

   Done when both services read `success`. Report the PR, the merge commit
   and the version now in production; a `failure` is diagnosed from the
   status's link before anything else merges.
