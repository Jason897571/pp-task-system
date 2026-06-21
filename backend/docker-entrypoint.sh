#!/bin/sh
set -e

# Apply database migrations, retrying until the DB is reachable.
echo "[entrypoint] running migrations..."
i=1
until alembic upgrade head; do
  if [ "$i" -ge 30 ]; then
    echo "[entrypoint] database not ready after 30 attempts, giving up." >&2
    exit 1
  fi
  echo "[entrypoint] database not ready, retry $i..."
  i=$((i + 1))
  sleep 2
done

# Optionally seed demo data (idempotent). Disable with RUN_SEED=0 in production.
if [ "${RUN_SEED:-0}" = "1" ]; then
  echo "[entrypoint] seeding demo data..."
  python seed.py || echo "[entrypoint] seed skipped/failed (non-fatal)."
fi

echo "[entrypoint] starting uvicorn..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
