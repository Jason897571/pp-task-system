# Task System — Backend

FastAPI + SQLAlchemy 2.0 + Alembic + MySQL 8. Implements the MVP endpoints in
`../docs/API_CONTRACT.md`.

## Setup

```bash
cd backend
uv venv --python 3.11 .venv
source .venv/bin/activate
uv pip install -r requirements.txt
cp .env.example .env        # adjust DATABASE_URL / TEST_DATABASE_URL if needed
```

## Migration / seed / run

```bash
alembic upgrade head        # create schema in the dev DB
python seed.py              # idempotent seed data
uvicorn app.main:app --port 8000 --reload
```

## Tests

Uses `TEST_DATABASE_URL` (`task_system_test`); tables are created/dropped per session.

```bash
python -m pytest -q
```

## Notes

- bcrypt is pinned to `<4.1` for passlib 1.7.4 compatibility.
- Deferred features (RecurringTask + scheduler, Tag, Checklist, Attachment,
  Notification, stats) have models but no endpoints — see TODOs in `app/models.py`.
