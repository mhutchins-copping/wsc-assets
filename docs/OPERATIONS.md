# Operations

> **Document:** Operations Runbook
> **Version:** 1.1
> **Last updated:** 2026-04-18
> **Owner (role):** IT Officer, Walgett Shire Council
> **Review cycle:** Annual — next review due 2027-04-18

Day-to-day runbook for WSC Assets. If something has gone wrong or a
routine task needs doing (adding a user, restoring from backup,
deploying a change) — this is the page.

## Contents

- [Routine tasks](#routine-tasks)
- [Deployment](#deployment)
- [Backups](#backups)
- [Restore from backup](#restore-from-backup)
- [Database migrations](#database-migrations)
- [Incident response](#incident-response)
- [Secrets and configuration](#secrets-and-configuration)

## Routine tasks

### Grant a staff member access to the app

Most of the time you don't need to do anything. Any `@walgett.nsw.gov.au`
SSO identity is auto-provisioned as a view-only `user` account on their
first visit — they hit the site, CF Access lets them through, and the
worker creates the row on the fly. This covers every "my asset isn't
showing up" ask.

To grant **admin** (or another specific role) ahead of time:

1. Settings → User Management → Add User.
2. Enter their `@walgett.nsw.gov.au` email, display name, and role.
3. Save. They can sign in immediately.

The allowed auto-provision domain is set by `AUTO_PROVISION_DOMAIN`
(Wrangler env var). Defaults to `walgett.nsw.gov.au` if unset.

Roles at a glance:

| Role    | Can read | Can mutate | Manage users | Notes |
| ------- | :------: | :--------: | :----------: | ----- |
| viewer  | ✔        |            |              | Read-only across the app. |
| user    | ✔        |            |              | Functionally identical to viewer today — kept as a distinct role so future operational-only permissions (e.g. check-out / check-in without full admin) can be granted later without mixing with viewer. |
| admin   | ✔        | ✔          | ✔            | Full access. Every mutation — create/edit/delete assets, check-out/check-in, send receipts, manage people, run Entra sync, enrol devices, manage users — is admin-only. |

Only grant **admin** to people who are expected to operate the register day-to-day. Everyone else who needs to see asset assignments gets `user` (or `viewer` — same effect).

### Revoke access

Settings → User Management → find the user → set `active = 0`. They
will be bounced on their next API request with a "no access" message.
SSO still works — they just can't use this app.

### Sync the staff directory from Entra

Settings → Entra ID Integration → "Sync Users from Entra".

This pulls all `@walgett.nsw.gov.au` accounts from Microsoft Graph,
creates any missing people, updates existing ones (name, department,
job title), and deactivates people whose emails no longer match the
filter. Existing asset assignments are preserved — deactivation is
soft, not a hard delete.

Run this after any significant HR churn (new hires, leavers,
restructure).

## Deployment

### Normal deploys

Deploys are automatic. `git push origin main` triggers GitHub Actions,
which:

1. Builds the frontend and pushes it to Cloudflare Pages.
2. Runs any pending D1 migrations (`wrangler d1 migrations apply`).
3. Deploys the worker.
4. Runs the smoke test against the live API.

If any step fails, the workflow fails visibly in the Actions tab. The
smoke test also catches deploys that succeed but break the API — if an
endpoint starts returning 500, the build goes red even though the
deploy technically "worked".

### Deploying manually (if GitHub Actions is down)

From the `worker/` directory on a machine with Wrangler installed and
authenticated:

```bash
npx wrangler d1 migrations apply wsc-assets-db --remote
npx wrangler deploy
```

From the repo root, to deploy the frontend:

```bash
npm run build
npx wrangler pages deploy dist --project-name=wsc-assets
```

## Backups

The `.github/workflows/backup.yml` workflow runs every Sunday at 02:00
UTC and exports the full D1 database to SQL. The file is uploaded as a
workflow artifact and retained for 90 days.

To download a backup:

1. Open the repo on GitHub → Actions → "Weekly D1 Backup".
2. Pick the run.
3. Scroll to Artifacts, download `d1-backup-<number>`.

To trigger an immediate backup (before a risky change, for example):

1. Actions → "Weekly D1 Backup" → "Run workflow".

The backup is stored on GitHub, which is a separate provider to
Cloudflare. This is deliberate: if the Cloudflare account were ever
compromised or suspended, the backups are unaffected.

## Restore from backup

> Restoring is a production-impacting operation. Do not run without a
> clear reason, ideally with a second person reviewing.

The restore process is scripted so nobody has to remember the correct
sequence of SQL commands under pressure. The script always takes a
safety export first, then applies the backup, then runs the smoke test.

### Steps

1. **Download the backup** you want to restore from (see [Backups](#backups)
   above) and save it locally.

2. **Dry-run the script** (safe — makes no changes):

   ```bash
   scripts/restore-db.sh path/to/wsc-assets-db-YYYY-MM-DD.sql
   ```

   Review the plan it prints. Confirm the database name, the backup
   file, the tables it would drop, and the safety-export path.

3. **Run the restore for real:**

   ```bash
   scripts/restore-db.sh path/to/wsc-assets-db-YYYY-MM-DD.sql --confirm
   ```

   The script will:

   - Export the current database to `backups/pre-restore-<timestamp>.sql`.
   - Drop all application tables.
   - Apply the backup SQL file.
   - Run the post-deploy smoke test.

4. **Spot-check via the UI.** Open `assets.it-wsc.com`, confirm the
   asset count and that users can sign in.

### Rolling back a restore

If something looks wrong after the restore, the safety export from
step 3 is the undo button. Re-run the script against it:

```bash
scripts/restore-db.sh backups/pre-restore-<timestamp>.sql --confirm
```

That returns the database to its exact state immediately before the
failed restore. The local `backups/` directory is gitignored — safety
exports never leave the operator's machine.

### Prerequisites for the script

- Wrangler installed (`npm install` in the `worker/` directory
  handles this) and authenticated. Either run `wrangler login`
  interactively, or export `CLOUDFLARE_API_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID` in your shell.
- Bash (any reasonably current version). Works from Git Bash on
  Windows, macOS, or Linux.

## Database migrations

### Adding a schema change

1. Create a new numbered file in `worker/migrations/`:
   `NNNN_short_description.sql` — keep the number higher than any
   existing migration.
2. Write the SQL. It runs exactly once, so non-idempotent
   `ALTER TABLE` is fine.
3. Update `worker/schema.sql` as well so a fresh install has the
   final shape. Migrations are for upgrading, `schema.sql` is for
   bootstrapping.
4. Commit and push. The deploy workflow applies the migration before
   the worker goes live.

### First-time bootstrap

If a fresh D1 instance is being stood up (new dev environment,
disaster recovery, etc.), the database has no `d1_migrations` tracking
table yet. Wrangler creates it on first run and attempts to run every
migration in order — which fails against an existing database that
already has those changes applied manually.

To bootstrap the tracking table on an existing unmanaged DB:

1. List every file in `worker/migrations/` (ordered by name — the
   numeric prefix keeps them sorted). These are the migrations that
   should be marked as already-applied:

   ```bash
   ls worker/migrations
   ```

2. In the D1 console, create the tracking table and insert one row
   per filename from step 1:

   ```sql
   CREATE TABLE IF NOT EXISTS d1_migrations (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT UNIQUE,
     applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
   );

   -- One line per filename from step 1. Copy-paste, don't retype.
   INSERT OR IGNORE INTO d1_migrations (name) VALUES
     ('0001_add_hardware_specs.sql'),
     ('0002_add_users.sql'),
     -- ...every file from the directory...
     ('NNNN_most_recent_migration.sql');
   ```

After that, only genuinely new migrations will run on future deploys.

The previous version of this document hard-coded the list of
migrations up to a point in time. It rotted within three months. Read
the directory instead.

## Incident response

### "The site is down"

1. **Check Cloudflare status:** <https://www.cloudflarestatus.com>.
   If they're having an incident, there's nothing to do but wait.
2. **Check the most recent deploy:** Actions tab on GitHub. If the
   last workflow failed, the problem is probably there. The logs will
   say which step broke.
3. **Check the worker:** `curl https://api.it-wsc.com/` — should
   return `{"error":"Not found"}`. If it returns nothing or times
   out, the worker is down. Re-run the deploy workflow to redeploy.
4. **Check CF Access:** open `https://assets.it-wsc.com` in a private
   window. If it doesn't redirect to Microsoft login, Access is
   misconfigured. Check Zero Trust dashboard → Access → Applications →
   WSC Assets → Policies.

### "Admin account is locked out"

If SSO is broken but the worker is up: use the master-key fallback
from the "No access" screen. The key is stored in the council's
password manager under "WSC Assets master key". Rate-limited to 5
attempts per IP per 15 minutes.

If the worker is also down: no way in until it's back. This is why
the master key only solves one failure mode, not all of them.

### "Assets deleted by mistake"

1. Check `activity_log` in the D1 console — every mutation is recorded
   with the acting user and a diff of what changed.
2. Assets aren't hard-deleted from the normal UI; they're marked
   `disposed`. Data is still there. Change the status back.
3. For a hard-delete (admin-only Delete button on an asset detail
   page), the row is gone from `assets`. Restore from the most recent
   weekly backup via the [restore process](#restore-from-backup).

## Secrets and configuration

### Wrangler secrets (set via `wrangler secret put <NAME>` in `worker/`)

| Secret                | Purpose                                         |
| --------------------- | ----------------------------------------------- |
| `API_KEY`             | Shared key for script-based callers (enrolment).|
| `MASTER_KEY`          | Break-glass login when SSO is unavailable.      |
| `ENTRA_TENANT_ID`     | Microsoft Graph — the council's tenant.         |
| `ENTRA_CLIENT_ID`     | Microsoft Graph — the app registration.         |
| `ENTRA_CLIENT_SECRET` | Microsoft Graph — the registered client secret. |

### GitHub Actions secrets

| Secret                  | Purpose                                        |
| ----------------------- | ---------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Deploy permission for Workers + Pages + D1.    |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account identifier.                 |

### Non-secret config (wrangler.toml → `[vars]`)

| Var                     | Value                                         |
| ----------------------- | --------------------------------------------- |
| `ASSET_TAG_PREFIX`      | `WSC` — prefix for generated asset tags.      |
| `CORS_ORIGIN`           | `https://assets.it-wsc.com` — allowed browser origin.|
| `NOTIFICATIONS_ENABLED` | `true` / `false` — toggle email alerts.       |

### Rotating a secret

1. Create the new value (e.g. new Entra client secret in Azure).
2. `cd worker && npx wrangler secret put <NAME>` — paste the new value.
3. The next request uses the new value. No restart required.
4. Revoke the old value at its source (Azure, password manager, etc.).

Never commit secrets to the repo. `.gitignore` blocks `.env*` and
`credentials.*` by default.
