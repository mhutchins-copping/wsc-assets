# Incident playbook

> **Document:** Incident response playbook
> **Owner (role):** IT Officer, Walgett Shire Council
> **Last updated:** 2026-04-28

When something goes wrong with WSC Assets, find the symptom below
and follow the recipe. Goal of this doc: the trainee's first
incident is a known-shape problem with a clear next step, not a
3am Google rabbit hole.

Severity convention used here:
- **P1**: site is down for everyone, or active data loss
- **P2**: feature broken for many users, or risk of data loss
- **P3**: cosmetic / single-user issue
- **P4**: enhancement / cleanup

## Contents

- [Health-check email arrived: deploy is green but health is red](#health-check-email-arrived-deploy-is-green-but-health-is-red)
- [Worker error email arrived](#worker-error-email-arrived)
- ["The site is down" — staff can't reach it](#the-site-is-down--staff-cant-reach-it)
- [Sign-in fails for everyone](#sign-in-fails-for-everyone)
- [Sign-in fails for one specific staff member](#sign-in-fails-for-one-specific-staff-member)
- [Deploy workflow is red](#deploy-workflow-is-red)
- [Apps not appearing on a council Android device](#apps-not-appearing-on-a-council-android-device)
- [Database needs to be restored](#database-needs-to-be-restored)
- [Master key needs to be rotated](#master-key-needs-to-be-rotated)
- [API key was leaked / committed by mistake](#api-key-was-leaked--committed-by-mistake)
- [Cloudflare account compromised](#cloudflare-account-compromised)
- [Conditional Access lockout (false-positive after enforcing)](#conditional-access-lockout-false-positive-after-enforcing)
- [Reviewing CA report-only logs (when to flip to enforce)](#reviewing-ca-report-only-logs-when-to-flip-to-enforce)

---

## Health-check email arrived: deploy is green but health is red

**Severity:** P1 if persisting > 10 min; P3 if a single transient.

**What's happening:** GH Actions Health Check workflow pinged
`/api/health` and got non-200. Either D1 is unreachable, the worker
itself is unhealthy, or there's a CF network issue between Actions
runners and the worker.

1. Hit the endpoint yourself: `curl https://api.it-wsc.com/api/health`.
   - 200 OK → the workflow run was a transient blip; ignore unless
     it keeps firing.
   - 503 with `{"checks": {"d1": "fail: ..."}}` → D1 is the issue.
     Check Cloudflare D1 status page + dashboard.
   - Times out / connection refused → worker itself isn't responding.
     Check Cloudflare Workers status + the latest deploy.
2. If D1 is the issue and CF status looks fine, the database may
   be migrating (rare but happens). Wait 5 min and recheck.
3. If the worker isn't responding and the latest deploy was > 1 hr
   ago, redeploy: from `worker/`, `npx wrangler deploy`. Forces a
   fresh upload.
4. If it persists past 30 min, escalate to Cloudflare support.

## Worker error email arrived

**Severity:** P2 by default. P1 if the error path is on a
read-heavy endpoint (assets list, dashboard).

**What's happening:** dispatch caught an uncaught exception. Email
contains the path, method, message, and stack trace. The frontend
showed a 500 to whoever triggered it.

1. Read the stack. Most useful line is usually the third one (the
   first two are the dispatch wrapper itself).
2. Reproduce via the same path with `curl` + the X-Api-Key header.
   If you reproduce it cleanly, you have a bug to fix. If you can't,
   it might be data-dependent.
3. If urgent, roll back: `git revert HEAD && git push`. CI redeploys
   the previous version.
4. Open a bug for the root cause with the stack trace + a
   reproduction.
5. The email dedup is per-isolate (~5 min). If the same error pings
   over and over, expect a few duplicates as isolates rotate.

## "The site is down" — staff can't reach it

**Severity:** P1.

1. **Check Cloudflare status:** <https://www.cloudflarestatus.com>.
   If they're having an incident, there's nothing to do but wait
   and update Matthew/exec.
2. **Check the most recent deploy:** Actions tab on GitHub. If the
   last workflow failed, the problem is probably there. The logs
   will say which step broke.
3. **Check the worker:** `curl https://api.it-wsc.com/api/health`.
   If it returns 200, the worker is fine and the problem is the
   frontend (CF Pages outage, or someone unbinding the domain).
4. **Check CF Access:** open `https://assets.it-wsc.com` in a
   private window. If it doesn't redirect to Microsoft login, Access
   is misconfigured. Check Zero Trust dashboard → Access →
   Applications → WSC Assets → Policies.
5. If the worker is also unreachable, this is now Cloudflare
   support's problem.

## Sign-in fails for everyone

**Severity:** P1.

1. Confirm the symptom: open the site in a private window. If you
   get an Entra error before reaching the app, this is upstream of
   us — Microsoft 365 is having issues, or the council's tenant has
   a problem. Check the Microsoft 365 Service health portal.
2. If you reach the app but get the "no access" page, the issue is
   the worker's identify endpoint:
   - Hit `POST https://api.it-wsc.com/api/auth/identify` with the
     CF Access cookie set. Should return `{authorized: true, ...}`.
   - If `needs_migration: true` is returned, the `users` table
     migration didn't run. Re-run via `npx wrangler d1 migrations
     apply wsc-assets-db --remote`.
3. Use the master-key login as a fallback for IT (Settings →
   Use master key on the sign-in screen). Key is in the council
   password manager.

## Sign-in fails for one specific staff member

**Severity:** P3 unless it's a key person.

1. Confirm they're in the `users` table: Settings → User Management
   → search. If absent and their email is `@walgett.nsw.gov.au`,
   they should auto-provision on first sign-in.
2. If the row exists but `active = 0`, someone disabled them. Check
   activity log to see when + why before re-enabling.
3. If they're not autoprovisioning, check `AUTO_PROVISION_DOMAIN`
   wrangler env var (should be `walgett.nsw.gov.au` or unset).
4. Have them clear their browser cache + sign in via private
   window. Stale CF Access cookies cause occasional weirdness.

## Deploy workflow is red

**Severity:** P2 (deploy is paused until fixed).

1. Open the failing run in the Actions tab. The failed step gives
   the cause.
2. Common causes:
   - **Build step failed** → frontend has a syntax error. Fix it
     and push.
   - **Migration step failed** → SQL error in a new migration.
     Fix the migration, force-push if needed.
   - **Worker deploy failed** → wrangler complaint, usually
     "missing binding" or "config invalid". Check `worker/wrangler.toml`.
   - **Smoke test failed** → API endpoint regressed. Worker WAS
     deployed (deploy succeeded before smoke test). Roll back via
     `git revert`.
3. While the deploy workflow is red, prod is on whatever the
   previous successful deploy left. Not down — just frozen.

## Apps not appearing on a council Android device

**Severity:** P3 unless multiple devices.

This was the mvandepitte / atimmons issue earlier. Almost always:
the device isn't a member of the dynamic group that Intune apps
are assigned to.

1. Find the device's `enrollmentProfileName` in *Entra → Devices*.
2. Verify it matches the `MDM – Android Pilot Devices` membership
   rule:
   `(device.enrollmentProfileName -startsWith "Android") and (device.deviceOwnership -eq "Company")`
3. Check membership: *Entra → Groups → MDM – Android Pilot Devices
   → Members*. If the device is missing, force re-evaluation:
   *Group → Dynamic membership rules → Validate*.
4. Force the device to sync: in Intune portal → Devices → click
   the device → Sync.
5. If still empty after 30 min, check whether the apps are
   actually assigned to that group (*Apps → All apps → app →
   Properties → Assignments*).

See also `docs/INTUNE-RUNBOOK.md` for the broader Intune workflow.

## Database needs to be restored

**Severity:** P1 (production-impacting).

Don't run this without a clear reason and ideally a second pair of
eyes.

1. Pull the backup: GitHub → Actions → "Weekly D1 Backup" → most
   recent run → Artifacts → download.
2. Unzip; the `.sql` file is what you want.
3. **Dry-run first** to see the plan: `scripts/restore-db.sh
   path/to/file.sql`. Confirms the table-drop list is current.
4. Execute: same command + `--confirm`. The script:
   - Exports the current DB to `backups/pre-restore-<ts>.sql` (your
     undo button)
   - Drops every application table
   - Applies the backup
   - Runs the smoke test
5. Spot-check via the UI: open the site, confirm asset count + that
   sign-in works.
6. If it looks wrong, roll back via the safety export the script
   created: `scripts/restore-db.sh backups/pre-restore-<ts>.sql --confirm`.

The restore script was last verified working (dry-run) on
2026-04-28.

## Master key needs to be rotated

**Severity:** P3 unless leaked (then P1).

1. Generate a new strong key (32+ random bytes from a password
   manager).
2. Set it on the worker: `cd worker && npx wrangler secret put
   MASTER_KEY` → paste the new value.
3. Update the council password manager entry "WSC Assets master
   key" with the new value.
4. Old key is now invalid — next master-key login attempt with the
   old value fails (and is logged).
5. If the key was leaked: also rotate `API_KEY` (same flow with
   `wrangler secret put API_KEY`) since the same threat actor likely
   has both, and reset any active sessions by running
   `DELETE FROM sessions;` in D1 console.

## API key was leaked / committed by mistake

**Severity:** P1 — treat as if exfil has already happened.

1. **Rotate immediately**: `cd worker && npx wrangler secret put
   API_KEY` → paste a fresh strong value. Old key now invalid.
2. **Update every consumer**: PowerShell enrolment script callers,
   any GPO that bakes the key in, any saved password-manager entries.
3. If the key was committed to git history: it's still in history
   even after deletion. Rotation is the only mitigation; force-pushing
   to rewrite history is not worth the trade-off (other clones still
   have it).
4. Log the incident in the council's security register.

## Cloudflare account compromised

**Severity:** P1.

1. Force sign-out across all sessions in the Cloudflare dashboard
   (Account → Members → manage sessions).
2. Reset CF account password via the recovery email path.
3. Re-issue API tokens (`CLOUDFLARE_API_TOKEN` in GH Actions
   secrets needs replacing) — old token is invalid, deploys break
   until updated.
4. Restore from off-Cloudflare backup if data was wiped — see
   "Database needs to be restored" above. Backups are stored in
   GitHub which is a separate provider.
5. Audit the worker for new code paths someone may have injected:
   check `git log --since="1 month ago"` on `main` for unfamiliar
   commits.

## Conditional Access lockout (false-positive after enforcing)

**Severity:** P1 (users can't reach M365).

If you flipped *WSC – Require compliant device or approved app for
M365* to enforce and now staff are blocked:

1. Open the policy in Entra → Conditional Access → Policies.
2. Set `state` back to **enabledForReportingButNotEnforced** (or
   **disabled** if reverting fully).
3. Save. Effect is immediate — affected users can sign in again
   on their next attempt.
4. Either re-deploy after fixing the underlying compliance gap
   (e.g. add the user's group to excludeGroups, or get their
   device compliant), or leave in report-only longer.

Programmatic version: `intune-audit/deploy-ca-require-compliant.ps1`
(no flag = report-only, `-Enforce` = enforced).

## Reviewing CA report-only logs (when to flip to enforce)

**Severity:** routine task.

The CA policy was deployed in report-only on 2026-04-28. After at
least a week of sign-ins, review the data before flipping to enforce.

1. Entra portal → **Sign-in logs** (or Sign-ins under Identity →
   Monitoring).
2. Add filter: **Conditional Access** = "Report-only: Failure".
3. Set the date range to "Last 7 days".
4. Each row = a sign-in that *would* have been blocked by enforced
   policy. Inspect:
   - **User**: who'd be blocked
   - **Application**: what they were trying to access
   - **Device**: was it managed? compliant?
5. Patterns to look for:
   - **Single user, repeatedly**: their device probably isn't
     compliant — fix that or exclude them while you do
   - **Many users, shared app**: that app needs to be on the
     approved-app list, OR the policy scope needs narrowing
   - **Empty list**: enforce. Council is ready.
6. To enforce: re-run
   `intune-audit/deploy-ca-require-compliant.ps1 -Enforce`.

If you go straight to enforce without reviewing report-only logs,
the most likely outcome is one or two users get locked out and
you find out via Teams complaint within 30 minutes. Not the end
of the world but avoidable.
