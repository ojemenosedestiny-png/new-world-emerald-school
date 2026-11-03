#!/usr/bin/env bash
# Puts a backup made by scripts/backup-db.sh back into a database. Every table in the backup replaces the
# table of the same name in the target, so restore into a NEW empty database when you can (see
# docs/DISASTER-RECOVERY.md) and only point the live site at it once it checks out.
#
#   TARGET_DATABASE_URL=<database to fill> BACKUP_PASSPHRASE=<secret> scripts/restore-backup.sh nwe-db-....dump.gpg
#
# Asks you to type RESTORE first (set RESTORE_CONFIRM=yes to skip, for automated checks).
# Needs pg_restore, psql and gpg.
set -euo pipefail

file="${1:?Give the backup file to restore (nwe-db-....dump.gpg, or an unencrypted .dump).}"
: "${TARGET_DATABASE_URL:?Set TARGET_DATABASE_URL to the database to restore into.}"
[ -f "$file" ] || { echo "ERROR: $file not found." >&2; exit 1; }

if [ "${RESTORE_CONFIRM:-}" != "yes" ]; then
  echo "This replaces the data in the target database with the backup in $file."
  read -r -p "Type RESTORE to continue: " answer
  [ "$answer" = "RESTORE" ] || { echo "Stopped. Nothing was changed."; exit 1; }
fi

plain="$(mktemp)"
trap 'rm -f "$plain"' EXIT
if [[ "$file" == *.gpg ]]; then
  : "${BACKUP_PASSPHRASE:?Set BACKUP_PASSPHRASE: the secret the backup was made with.}"
  printf '%s' "$BACKUP_PASSPHRASE" | gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 0 \
    --decrypt --output "$plain" "$file"
else
  cp "$file" "$plain"
fi
# Refuse a damaged or wrong file before touching the database.
pg_restore --list "$plain" > /dev/null

# All or nothing: if any step fails, the target is left exactly as it was.
pg_restore --clean --if-exists --no-owner --no-privileges --single-transaction --exit-on-error \
  --dbname="$TARGET_DATABASE_URL" "$plain"

echo "Restored. Rows now in the main tables:"
psql "$TARGET_DATABASE_URL" -X -At -F ': ' -c "
  select 'students', count(*) from portal_students union all
  select 'teachers', count(*) from portal_teachers union all
  select 'classes', count(*) from portal_classes union all
  select 'report card scores', count(*) from portal_scores union all
  select 'exams', count(*) from portal_exams union all
  select 'exam attempts', count(*) from portal_attempts union all
  select 'online fee payments', count(*) from parent_payments"
