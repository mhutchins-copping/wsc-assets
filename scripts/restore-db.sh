#!/usr/bin/env bash
# Restore WSC Assets D1 database from a backup SQL file.
#
# Usage:
#   scripts/restore-db.sh <backup.sql>              # dry-run, shows plan
#   scripts/restore-db.sh <backup.sql> --confirm    # actually runs
#
# Requires: Wrangler authenticated (CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
# in env, or an interactive wrangler login).
#
# What it does:
#   1. Sanity checks the backup file looks like a D1 export
#   2. Exports the current live database as pre-restore-<ts>.sql (safety net)
#   3. Drops every application table (clean slate)
#   4. Applies the backup SQL file to rebuild schema + data
#   5. Runs the post-deploy smoke test to confirm the API is still healthy
#
# If anything fails after step 2, the safety-net file is your undo:
#   scripts/restore-db.sh pre-restore-<ts>.sql --confirm

set -euo pipefail

DB="wsc-assets-db"
BACKUP="${1:-}"
CONFIRM="${2:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKER_DIR="$REPO_ROOT/worker"
SAFETY_DIR="$REPO_ROOT/backups"

# ── Pre-flight ──────────────────────────────────────────────────

if [[ -z "$BACKUP" ]]; then
  cat >&2 <<'EOF'
Usage:
  scripts/restore-db.sh <backup.sql>              # dry-run
  scripts/restore-db.sh <backup.sql> --confirm    # execute
EOF
  exit 1
fi

if [[ ! -f "$BACKUP" ]]; then
  echo "ERROR: backup file not found: $BACKUP" >&2
  exit 1
fi

# Absolute path so we can cd around without losing the reference
BACKUP="$(cd "$(dirname "$BACKUP")" && pwd)/$(basename "$BACKUP")"

# Sanity-check the file looks like a D1 export. Wrangler exports contain
# CREATE TABLE statements at minimum.
if ! grep -qiE "^CREATE TABLE" "$BACKUP"; then
  echo "ERROR: $BACKUP does not contain CREATE TABLE statements." >&2
  echo "       This does not look like a wrangler d1 export. Aborting." >&2
  exit 1
fi

SIZE_KB=$(( $(wc -c < "$BACKUP") / 1024 ))
STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
SAFETY_FILE="$SAFETY_DIR/pre-restore-${STAMP}.sql"

# Tables to wipe before applying the backup. Order is parent-last to keep
# referential state tidy even though D1 does not enforce foreign keys by
# default. d1_migrations is included so the restored state owns its own
# migration history.
TABLES=(
  activity_log
  maintenance_log
  audit_items
  audits
  assets
  people
  users
  categories
  locations
  d1_migrations
)

# ── Plan summary ────────────────────────────────────────────────

cat <<EOF
Restore plan
────────────
  Database:       $DB (remote)
  Backup file:    $BACKUP
  Backup size:    ${SIZE_KB} KB
  Safety export:  $SAFETY_FILE
  Tables to drop: ${TABLES[*]}

Steps:
  1. Export current DB to safety file above
  2. Drop all application tables
  3. Apply backup file (rebuilds schema + data)
  4. Run smoke test against live API

EOF

if [[ "$CONFIRM" != "--confirm" ]]; then
  echo "Dry-run complete. Re-run with --confirm to execute:"
  echo "  scripts/restore-db.sh \"$BACKUP\" --confirm"
  exit 0
fi

# ── Execute ─────────────────────────────────────────────────────

mkdir -p "$SAFETY_DIR"
cd "$WORKER_DIR"

echo
echo "==> Step 1/4: safety export"
npx wrangler d1 export "$DB" --remote --output "$SAFETY_FILE"
if [[ ! -s "$SAFETY_FILE" ]]; then
  echo "ERROR: safety export produced an empty file. Aborting before any destructive action." >&2
  exit 1
fi
echo "  wrote $(wc -c < "$SAFETY_FILE") bytes to $SAFETY_FILE"

echo
echo "==> Step 2/4: drop application tables"
DROP_SQL=""
for t in "${TABLES[@]}"; do
  DROP_SQL+="DROP TABLE IF EXISTS ${t}; "
done
npx wrangler d1 execute "$DB" --remote --command "$DROP_SQL"

echo
echo "==> Step 3/4: apply backup"
npx wrangler d1 execute "$DB" --remote --file "$BACKUP"

echo
echo "==> Step 4/4: smoke test"
bash "$SCRIPT_DIR/smoke-test.sh"

echo
echo "Restore complete."
echo "Safety export retained at: $SAFETY_FILE"
echo "If anything looks wrong in the UI, roll back with:"
echo "  scripts/restore-db.sh \"$SAFETY_FILE\" --confirm"
