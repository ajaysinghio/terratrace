#!/usr/bin/env bash
# Manual backup/restore between the hosted Neon database and the local
# docker-compose Postgres (offline demo / DR copy).
#   scripts/local-db.sh dump             Neon -> backups/neon-<timestamp>.sql (+ backups/latest.sql)
#   scripts/local-db.sh restore [file]   file (default backups/latest.sql) -> local Postgres, replacing its data
#   scripts/local-db.sh sync             dump, then restore
# Neon is only ever read (pg_dump); restore only ever writes to the local container.
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE=(docker compose -f ../../docker-compose.yml)
BACKUP_DIR=backups

source_url() {
  if [ -n "${SOURCE_DATABASE_URL:-}" ]; then echo "$SOURCE_DATABASE_URL"; return; fi
  [ -f .env ] || { echo "No .env here and SOURCE_DATABASE_URL is unset." >&2; exit 1; }
  grep '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//'
}

ensure_local_db() {
  "${COMPOSE[@]}" up -d --wait db >/dev/null
}

do_dump() {
  local url file
  url="$(source_url)"
  case "$url" in *localhost*|*127.0.0.1*) echo "Source DATABASE_URL points at localhost — refusing to dump the local DB over itself." >&2; exit 1;; esac
  ensure_local_db
  mkdir -p "$BACKUP_DIR"
  file="$BACKUP_DIR/neon-$(date +%Y%m%d-%H%M%S).sql"
  # pg_dump runs inside the container so no local Postgres client is needed.
  "${COMPOSE[@]}" exec -T -e SRC="$url" db sh -c 'pg_dump --schema=public --no-owner --no-acl --clean --if-exists "$SRC"' > "$file"
  cp "$file" "$BACKUP_DIR/latest.sql"
  echo "Dumped to dashboard/$file ($(wc -c < "$file" | tr -d ' ') bytes)"
}

do_restore() {
  local file="${1:-$BACKUP_DIR/latest.sql}"
  [ -f "$file" ] || { echo "No backup file at $file — run 'dump' first." >&2; exit 1; }
  ensure_local_db
  "${COMPOSE[@]}" exec -T db psql -q -v ON_ERROR_STOP=1 -U terratrace -d terratrace < "$file" >/dev/null
  echo "Restored $file into local Postgres (localhost:5433)."
}

case "${1:-}" in
  dump) do_dump ;;
  restore) do_restore "${2:-}" ;;
  sync) do_dump; do_restore ;;
  *) echo "Usage: $0 {dump|restore [file]|sync}" >&2; exit 1 ;;
esac
