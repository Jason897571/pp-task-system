"""APScheduler daily job that materializes recurring task instances.

Disabled automatically under pytest (sys.modules check) and can be turned off
explicitly with DISABLE_SCHEDULER=1.
"""

import os
import sys
from datetime import date

from apscheduler.schedulers.background import BackgroundScheduler

from app.database import SessionLocal
from app.services import generate_recurring_instances

_scheduler: BackgroundScheduler | None = None


def _daily_job() -> None:
    db = SessionLocal()
    try:
        generate_recurring_instances(db, date.today())
        db.commit()
    finally:
        db.close()


def scheduler_enabled() -> bool:
    if os.getenv("DISABLE_SCHEDULER") == "1":
        return False
    if "pytest" in sys.modules:
        return False
    return True


def start_scheduler() -> None:
    global _scheduler
    if not scheduler_enabled() or _scheduler is not None:
        return
    _scheduler = BackgroundScheduler()
    # run once a day at 00:05 local time
    _scheduler.add_job(_daily_job, "cron", hour=0, minute=5, id="recurring_daily")
    _scheduler.start()


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
