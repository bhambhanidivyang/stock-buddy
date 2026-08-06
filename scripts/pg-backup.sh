#!/usr/bin/env sh
# Daily Postgres logical backup for Stock Buddy (cron-ready; not installed by default).
#
# Usage (from host with compose project running):
#   ./scripts/pg-backup.sh
#
# Example crontab (VM local time or UTC — adjust as needed):
#   15 19 * * 1-5 /opt/stock-buddy/scripts/pg-backup.sh >> /var/log/stock-buddy-backup.log 2>&1
#
# Requires: docker compose, env POSTGRES_* from repo-root .env (or export them).

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

if [ -f .env ]; then
  # shellcheck disable=SC1091
  set -a
  . ./.env
  set +a
fi

POSTGRES_USER=${POSTGRES_USER:-postgres}
POSTGRES_DB=${POSTGRES_DB:-stockbuddy}
CONTAINER=${POSTGRES_CONTAINER:-stock-buddy-postgres}
BACKUP_DIR=${BACKUP_DIR:-"$ROOT_DIR/backups"}
KEEP_DAYS=${BACKUP_KEEP_DAYS:-14}

mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y%m%d_%H%M%S)
OUT="$BACKUP_DIR/${POSTGRES_DB}_${STAMP}.sql.gz"

echo "[pg-backup] dumping ${POSTGRES_DB} from ${CONTAINER} → ${OUT}"

docker exec -e PGPASSWORD="${POSTGRES_PASSWORD:-}" "$CONTAINER" \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists \
  | gzip -c > "$OUT"

# prune old dumps
find "$BACKUP_DIR" -type f -name "*.sql.gz" -mtime "+${KEEP_DAYS}" -print -delete || true

echo "[pg-backup] done ($(du -h "$OUT" | awk '{print $1}'))"
