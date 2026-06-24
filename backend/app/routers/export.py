"""Weekly export (super_admin): completed-this-week, in-progress/todo snapshot,
and completed-last-week task lists, as a downloadable JSON payload.

A task has no explicit completed_at; completion is "sits in a done/final column or
has been archived". `updated_at` (a finished card's last change is reaching the
done column or being swept into the archive) is used as the completion timestamp
for the weekly windows. created_at/updated_at are stored in Shanghai local time;
due_date is naive UTC.
"""

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends
from sqlalchemy import false, or_, select, true
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_super_admin
from app.models import Board, BoardColumn, Task, User

router = APIRouter(prefix="/api", tags=["export"])

SH = ZoneInfo("Asia/Shanghai")


def _week_bounds(now_local: datetime):
    """Mon 00:00 of last week, this week, and next week (naive Shanghai wall-clock)."""
    midnight = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    this_monday = midnight - timedelta(days=now_local.weekday())
    return this_monday - timedelta(days=7), this_monday, this_monday + timedelta(days=7)


def _iso_sh(dt: datetime | None) -> str | None:
    return dt.replace(tzinfo=SH).isoformat() if dt else None


def _iso_utc(dt: datetime | None) -> str | None:
    return dt.replace(tzinfo=timezone.utc).isoformat() if dt else None


@router.get("/export/weekly")
def export_weekly(
    user: User = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    now_local = datetime.now(SH).replace(tzinfo=None)
    last_monday, this_monday, next_monday = _week_bounds(now_local)

    boards = {b.id: b for b in db.scalars(select(Board)).all()}
    cols = {c.id: c for c in db.scalars(select(BoardColumn)).all()}
    archive_board_ids = {b.id for b in boards.values() if b.is_archive}
    done_or_final_ids = {
        c.id for c in cols.values() if c.kind == "done" or c.is_final
    }

    def is_completed(t: Task) -> bool:
        return t.board_id in archive_board_ids or t.column_id in done_or_final_ids

    def names(t: Task) -> tuple[str | None, str | None]:
        col = cols.get(t.column_id) if t.column_id else None
        # Archived cards: their column carries the origin board id; surface that as
        # the board so the report reads against the real project, not "归档看板".
        if col is not None and col.source_board_id is not None:
            origin = boards.get(col.source_board_id)
            return (origin.name if origin else None), "已归档"
        board = boards.get(t.board_id)
        return (board.name if board else None), (col.name if col else None)

    def status_label(t: Task) -> str:
        if is_completed(t):
            return "已完成"
        if t.lifecycle == "open":
            return "待认领（任务池）"
        if t.lifecycle == "pending_approval":
            return "待审批"
        col = cols.get(t.column_id) if t.column_id else None
        return col.name if col and col.name else "进行中"

    def serialize(t: Task, *, completed: bool) -> dict:
        board_name, col_name = names(t)
        out = {
            "id": t.id,
            "title": t.title,
            "description": t.description,
            "priority": t.priority,
            "status": status_label(t),
            "board": board_name,
            "column": col_name,
            "assignee": t.assignee.full_name if t.assignee else None,
            "creator": t.creator.full_name if t.creator else None,
            "is_mandatory": t.is_mandatory,
            "is_rework": t.is_rework,
            "tags": [tag.name for tag in t.tags],
            "due_date": _iso_utc(t.due_date),
            "created_at": _iso_sh(t.created_at),
            "updated_at": _iso_sh(t.updated_at),
        }
        if completed:
            out["completed_at"] = _iso_sh(t.updated_at)  # proxy, see module docstring
        return out

    # --- completed buckets: in a done/final column or archived, by updated_at week ---
    completed_cond = or_(
        Task.column_id.in_(done_or_final_ids) if done_or_final_ids else false(),
        Task.board_id.in_(archive_board_ids) if archive_board_ids else false(),
    )
    base_completed = (
        select(Task)
        .where(Task.deleted_at.is_(None), Task.lifecycle == "on_board", completed_cond)
        .order_by(Task.updated_at.desc())
    )
    this_week = db.scalars(
        base_completed.where(
            Task.updated_at >= this_monday, Task.updated_at < next_monday
        )
    ).all()
    last_week = db.scalars(
        base_completed.where(
            Task.updated_at >= last_monday, Task.updated_at < this_monday
        )
    ).all()

    # --- snapshot: every unfinished card right now (in-progress / todo / pool) ---
    not_done_cond = (
        Task.column_id.not_in(done_or_final_ids) if done_or_final_ids else true()
    )
    snapshot = db.scalars(
        select(Task)
        .where(
            Task.deleted_at.is_(None),
            Task.board_id.not_in(archive_board_ids) if archive_board_ids else true(),
            or_(
                Task.lifecycle.in_(("open", "pending_approval")),
                (Task.lifecycle == "on_board") & not_done_cond,
            ),
        )
        .order_by(Task.priority, Task.created_at.desc())
    ).all()

    return {
        "generated_at": datetime.now(SH).isoformat(),
        "week": {
            "this_week": {
                "start": this_monday.date().isoformat(),
                "end": (next_monday - timedelta(days=1)).date().isoformat(),
            },
            "last_week": {
                "start": last_monday.date().isoformat(),
                "end": (this_monday - timedelta(days=1)).date().isoformat(),
            },
        },
        "counts": {
            "this_week_completed": len(this_week),
            "in_progress_or_todo": len(snapshot),
            "last_week_completed": len(last_week),
        },
        "this_week_completed": [serialize(t, completed=True) for t in this_week],
        "in_progress_or_todo": [serialize(t, completed=False) for t in snapshot],
        "last_week_completed": [serialize(t, completed=True) for t in last_week],
    }
