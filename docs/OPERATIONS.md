# Operations

Day-to-day runbook for WSC Assets. If something has gone wrong or you're
doing a routine task (adding a user, restoring from backup, deploying a
change) — this is the page.

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

1. Settings → User Management → Add User.
2. Enter their `@walgett.nsw.gov.au` email, display name, and role.
3. Save. They can now sign in immediately.

Roles at a glance:

| Role    | Can read | Can edit assets | Can manage users |
| ------- | :------: | :-------------: | :--------------: |
| viewer  | ✔        |                 |                  |
| user    | ✔        | ✔               |                  |
| admin   | ✔        | ✔               | ✔                |

### Revoke access

Settings → User Management → find the user → set `active = 0`. They'll be
bounced on their next API request with a "no access" message. SSO still
works — they just can't use this app.

### Sync the staff directory from Entra

Settings → Entra ID Integration → "Sync Users from Entra".

This pulls all `@walgett.nsw.gov.au` accounts from Microsoft Graph, creates
any missing people, updates existing ones (name, department, job title),
and deactivates people whose emails no longer match the filter. Existing
asset assignments are preserved — deactivation is soft, not a hard delete.

Run this after any significant HR churn (new hires, leavers, restructure).

## Deployment

### Normal deploys

You don't do deploys manually. `git push origin main` triggers GitHub
Actions which:

1. Builds the frontend and pushes it to Cloudflare Pages.
2. Runs any pending D1 migrations (`wrangler d1 migrations apply`).
3. Deploys the worker.
4. Runs the smoke test against the live API.

If any step fails, the workflow fails visibly in the Actions tab. The
smoke test also catches deploys that succeed but break the API — if an
endpoint starts returning 500, the build goes red even though the deploy
technically "worked".

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

The `.github/workflows/backup.yml` workflow runs every Sunday at 02:00 UTC
and exports the full D1 database to SQL. The file is uploaded as a
workflow artifact and retained for 90 days.

To download a backup:

1. Open the repo on GitHub → Actions → "Weekly D1 Backup".
2. Pick the run you want.
3. Scroll to Artifacts, download `d1-backup-<number>`.

To trigger an immediate backup (before a risky change, for example):

1. Actions → "Weekly D1 Backup" → "Run workflow".

The backup is stored on GitHub, which is a separate provider to Cloudflare.
This is deliberate: if the Cloudflare account were ever compromised or
suspended, the backups are unaffected.

## Restore from backup

> Restoring is a production-impacting operation. Do not run this without
> a clear reason and, ideally, a second person reviewing.

Assuming you have `wsc-assets-db-YYYY-MM-DD.sql` downloaded locally:

1. **Export the current database first** as a safety net. If the restore
   goes wrong, this is what you roll back to:
   ```bash
   cd worker
   npx wrangler d1 export wsc-assets-db --remote --output=pre-restore-$(date +%s).sql
   ```
2. **Drop the existing data.** There is no clean "replace database" in D1
   — you have to truncate each table manually. From the D1 console in the
   Cloudflare dashboard:
   ```sql
   DELETE FROM activity_log;
   DELETE FROM maintenance_log;
   DELETE FROM audit_items;
   DELETE FROM audits;
   DELETE FROM assets;
   DELETE FROM people;
   DELETE FROM users;
   DELETE FROM categories;
   DELETE FROM locations;
   ```
   (Order matters — child tables before parents to avoid FK issues.)
3. **Apply the backup SQL file:**
   ```bash
   npx wrangler d1 execute wsc-assets-db --remote --file=wsc-assets-db-YYYY-MM-DD.sql
   ```
4. **Run the smoke test** to confirm the worker is still healthy:
   ```bash
   bash scripts/smoke-test.sh
   ```
5. **Spot-check via the UI.** Open `assets.it-wsc.com`, verify the asset
   count, that users can sign in, that the dashboard loads.

If step 3 fails partway through: your safety export from step 1 is your
undo. Drop the tables again and apply the safety export.

## Database migrations

### Adding a schema change

1. Create a new numbered file in `worker/migrations/`:
   `NNNN_short_description.sql` — keep the number higher than any
   existing migration.
2. Write the SQL. It runs exactly once, so non-idempotent `ALTER TABLE` is
   fine.
3. Update `worker/schema.sql` as well so a fresh install has the final
   shape. Migrations are for upgrading, `schema.sql` is for bootstrapping.
4. Commit and push. The deploy workflow applies the migration before the
   worker goes live.

### First-time bootstrap

If you're standing up a fresh D1 instance (new dev environment, disaster
recovery, etc.), the database has no `d1_migrations` tracking table yet.
Wrangler will try to run every migration in order, which will fail because
the live DB already has most of those changes applied manually.

To bootstrap the tracking table on an existing-but-unmanaged DB, run this
once in the D1 console, listing every migration that has already been
applied by hand:

```sql
CREATE TABLE IF NOT EXISTS d1_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO d1_migrations (name) VALUES
  ('0001_add_hardware_specs.sql'),
  ('0002_add_users.sql'),
  ('0003_fix_audits_and_indexes.sql'),
  ('0004_drop_software_licenses.sql'),
  ('0005_add_notifications_enabled.sql'),
  ('0006_add_activity_ip_address.sql');
```

After that, only genuinely new migrations will run on future deploys.

## Incident response

### "The site is down"

1. **Check Cloudflare status:** <https://www.cloudflarestatus.com>. If
   they're having an incident, there's nothing to do but wait.
2. **Check the most recent deploy:** Actions tab on GitHub. If the last
   workflow failed, the problem is probably there. The logs will say
   which step broke.
3. **Check the worker:** `curl https://api.it-wsc.com/` — should return
   `{"error":"Not found"}`. If it returns nothing / times out, the worker
   is down. Re-run the deploy workflow to redeploy.
4. **Check CF Access:** try opening `https://assets.it-wsc.com` in a
   private window. If you're not redirected to Microsoft login, Access
   is misconfigured. Check Zero Trust dashboard → Access → Applications
   → WSC Assets → Policies.

### "I'm locked out"

If SSO is broken but the worker is up: use the master-key fallback from
the "No access" screen. The key is stored in 1Password (see the shared
vault entry "WSC Assets master key"). Rate-limited to 5 attempts per IP
per 15 minutes.

If the worker is also down: no way in until it's back. This is why the
master key only solves one failure mode, not all of them.

### "Someone deleted a bunch of assets by mistake"

1. Check `activity_log` in the D1 console — every mutation is recorded with
   the acting user and a diff of what changed. That tells you who did what.
2. Assets aren't hard-deleted from the UI; they're marked `disposed`. Data
   is still there. If you need them back, change the status back.
3. For a hard-delete (via the admin-only Delete button on an asset detail
   page), the asset is gone from `assets`. Restore from the most recent
   weekly backup.

## Secrets and configuration

### Wrangler secrets (set via `wrangler secret put <NAME>` in `worker/`)

| Secret                  | Purpose                                           |
| ----------------------- | ------------------------------------------------- |
| `API_KEY`               | Shared key for script-based callers (enrolment).  |
| `MASTER_KEY`            | Break-glass login when SSO is unavailable.        |
| `ENTRA_TENANT_ID`       | Microsoft Graph — the council's tenant.           |
| `ENTRA_CLIENT_ID`       | Microsoft Graph — the app registration.           |
| `ENTRA_CLIENT_SECRET`   | Microsoft Graph — the registered client secret.   |

### GitHub Actions secrets

| Secret                  | Purpose                                           |
| ----------------------- | ------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Deploy permission for Workers + Pages + D1.       |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account identifier.                    |

### Non-secret config (wrangler.toml → `[vars]`)

| Var                     | Value                                             |
| ----------------------- | ------------------------------------------------- |
| `ASSET_TAG_PREFIX`      | `WSC` — the prefix for generated asset tags.      |
| `CORS_ORIGIN`           | `https://assets.it-wsc.com` — allowed browser origin. |
| `NOTIFICATIONS_ENABLED` | `true` / `false` — toggle email alerts.           |

### Rotating a secret

1. Create the new value (e.g. new Entra client secret in Azure).
2. `cd worker && npx wrangler secret put <NAME>` — paste the new value.
3. The next request uses the new value. No restart required.
4. Revoke the old value at its source (Azure, 1Password, wherever).

Never commit secrets to the repo. `.gitignore` blocks `.env*` and
`credentials.*` by default.
