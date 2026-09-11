#!/bin/sh
set -eu

schema_state="$({ python - <<'PY'
from sqlalchemy import inspect

from app.database import engine

tables = set(inspect(engine).get_table_names())
if "alembic_version" in tables:
    print("managed")
elif {"organisations", "users", "robots", "features"}.issubset(tables):
    print("legacy-baseline")
else:
    print("empty")
PY
} 2>/dev/null)"

if [ "$schema_state" = "legacy-baseline" ]; then
  echo "[database] Legacy schema detected; stamping migration 0001."
  alembic stamp 0001
fi

echo "[database] Applying migrations."
alembic upgrade head

exec uvicorn app.main:app --host 0.0.0.0 --port 8000
