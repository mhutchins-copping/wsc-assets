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
# Safety properties:
#   - Tables are detected dynamically from sqlite_master, not a hand-list.
#     A new table added to the schema can't be missed.
#   - Schema version is validated: if the backup contains a migration
#     newer than this checkout knows about, we refuse rather than silently
#     restoring into a worker that doesn't understand its own DB.
#   - The current DB is exported as pre-restore-<ts>.sql before any
#     destructive action, so a bad restore can be undone with this same
#     script pointed at the safety file.

set -euo pipefail

DB="wsc-assets-db"
BACKUP="${1:-}"
CONFIRM="${2:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKER_DIR="$REPO_ROOT/worker"
SAFETY_DIR="$REPO_ROOT/backups"
MIGRATIONS_DIR="$WORKER_DIR/migrations"

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

# Sanity-check the file looks like a D1 export.
if ! grep -qiE "^CREATE TABLE" "$BACKUP"; then
  echo "ERROR: $BACKUP does not contain CREATE TABLE statements." >&2
  echo "       This does not look like a wrangler d1 export. Aborting." >&2
  exit 1
fi

# ── Schema version check ────────────────────────────────────────
# The backup will contain INSERT INTO d1_migrations entries listing every
# migration that had been applied to the source DB. If the backup
# references a migration file that doesn't exist in this checkout, the
# restored DB will be ahead of the worker code — refuse.
#
# Repo's highest migration: highest 4-digit prefix in migrations/.
REPO_MAX="$(ls "$MIGRATIONS_DIR" 2>/dev/null | grep -oE '^[0-9]{4}' | sort -n | tail -1 || echo "")"
# Backup's highest migration: pick out any 'NNNN_*.sql' references in the file.
BACKUP_MAX="$(grep -oE "[0-9]{4}_[a-z_]+\.sql" "$BACKUP" 2>/dev/null | grep -oE '^[0-9]{4}' | sort -n | tail -1 || echo "")"

if [[ -n "$BACKUP_MAX" && -n "$REPO_MAX" ]]; then
  if [[ "$BACKUP_MAX" -gt "$REPO_MAX" ]]; then
    echo "ERROR: schema version mismatch." >&2
    echo "       Backup was taken at migration $BACKUP_MAX, but this checkout only goes to $REPO_MAX." >&2
    echo "       Pull the latest main branch (which contains migration $BACKUP_MAX) before restoring," >&2
    echo "       or use a backup taken at version <= $REPO_MAX." >&2
    exit 1
  fi
fi

SIZE_KB=$(( $(wc -c < "$BACKUP") / 1024 ))
STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
SAFETY_FILE="$SAFETY_DIR/pre-restore-${STAMP}.sql"

# ── Plan summary ────────────────────────────────────────────────

cat <<EOF
Restore plan
────────────
  Database:        $DB (remote)
  Backup file:     $BACKUP
  Backup size:     ${SIZE_KB} KB
  Backup schema:   migration ${BACKUP_MAX:-unknown}
  Repo schema:     migration ${REPO_MAX:-unknown}
  Safety export:   $SAFETY_FILE

Steps:
  1. Export current DB to safety file above
  2. Discover application tables dynamically from sqlite_master
  3. Drop all discovered tables (clean slate)
  4. Apply backup file (rebuilds schema + data)
  5. Run smoke test against live API

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
echo "==> Step 1/5: safety export"
npx wrangler d1 export "$DB" --remote --output "$SAFETY_FILE"
if [[ ! -s "$SAFETY_FILE" ]]; then
  echo "ERROR: safety export produced an empty file. Aborting before any destructive action." >&2
  exit 1
fi
echo "  wrote $(wc -c < "$SAFETY_FILE") bytes to $SAFETY_FILE"

echo
echo "==> Step 2/5: discover tables"
# Query sqlite_master for live table list. Excludes:
#   sqlite_*  - SQLite internal (sqlite_sequence, sqlite_stat1, etc.)
#   _cf_*     - Cloudflare D1 internal tables (DO NOT TOUCH)
TABLES_JSON="$(npx wrangler d1 execute "$DB" --remote --json --command \
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'")"
# Extract names; the JSON shape is [{ results: [{name: '...'}, ...] }]
TABLES=$(echo "$TABLES_JSON" | node -e '
  let s=""; process.stdin.on("data",c=>s+=c); process.stdin.on("end",()=>{
    try {
      const j=JSON.parse(s); const r=Array.isArray(j)?j[0].results:j.results;
      console.log(r.map(x=>x.name).join(" "));
    } catch (e) { console.error("parse error:",e.message); process.exit(1); }
  });')
if [[ -z "$TABLES" ]]; then
  echo "  no application tables found (fresh DB? proceeding)"
else
  echo "  found: $TABLES"
fi

echo
echo "==> Step 3/5: drop discovered tables"
if [[ -n "$TABLES" ]]; then
  DROP_SQL=""
  for t in $TABLES; do
    DROP_SQL+="DROP TABLE IF EXISTS \"${t}\"; "
  done
  npx wrangler d1 execute "$DB" --remote --command "$DROP_SQL"
fi

echo
echo "==> Step 4/5: apply backup"
npx wrangler d1 execute "$DB" --remote --file "$BACKUP"

echo
echo "==> Step 5/5: smoke test"
bash "$SCRIPT_DIR/smoke-test.sh"

echo
echo "Restore complete."
echo "Safety export retained at: $SAFETY_FILE"
echo "If anything looks wrong in the UI, roll back with:"
echo "  scripts/restore-db.sh \"$SAFETY_FILE\" --confirm"
