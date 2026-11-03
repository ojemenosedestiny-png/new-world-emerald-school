#!/usr/bin/env bash
# Makes an encrypted copy of the school database: nwe-db-<UTC time>.dump.gpg (AES-256).
# The unencrypted copy only ever exists in a temporary file, deleted on exit.
#
#   DATABASE_URL=<Render External Database URL> BACKUP_PASSPHRASE=<secret> scripts/backup-db.sh [output-dir]
#
# Needs pg_dump (same major version as the database, or newer) and gpg. Prints the backup file's path.
# Restore with scripts/restore-backup.sh; see docs/DISASTER-RECOVERY.md.
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to the database to copy (Render: Database -> Connect -> External Database URL).}"
: "${BACKUP_PASSPHRASE:?Set BACKUP_PASSPHRASE. Keep the same secret somewhere safe outside GitHub too: without it the backups cannot be opened.}"
if [ "${#BACKUP_PASSPHRASE}" -lt 20 ]; then echo "ERROR: BACKUP_PASSPHRASE must be at least 20 characters." >&2; exit 1; fi

out_dir="${1:-.}"
mkdir -p "$out_dir"
plain="$(mktemp)"
trap 'rm -f "$plain"' EXIT

# Custom format: compressed, and pg_restore can put back the whole database or single tables.
pg_dump --format=custom --no-owner --no-privileges --dbname="$DATABASE_URL" --file="$plain"
pg_restore --list "$plain" > /dev/null

file="$out_dir/nwe-db-$(date -u +%Y-%m-%dT%H%MZ).dump.gpg"
printf '%s' "$BACKUP_PASSPHRASE" | gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 0 \
  --symmetric --cipher-algo AES256 --output "$file" "$plain"
echo "$file"
