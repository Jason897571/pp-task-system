from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_admin
from app.models import BoardColumn, Task, User
from app.schemas import UserOut
from app.services import board_can_see

router = APIRouter(prefix="/api", tags=["stats"])

DONE_KIND = "done"
REVIEW_KIND = "review"


def _dept_scope(stmt, user: User):
    if user.role != "super_admin":
        stmt = stmt.where(Task.department_id == user.department_id)
    return stmt


@router.get("/stats/overview")
def overview(
    board_id: int | None = Query(default=None),
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if board_id is not None and not board_can_see(db, user, board_id):
        raise HTTPException(status_code=403, detail="无权查看该看板")

    now = datetime.now(timezone.utc).replace(tzinfo=None)

    # per-column counts for on-board tasks; dept filter lives in the join
    # condition so columns with zero matching tasks still appear (count 0).
    cond = (
        (Task.column_id == BoardColumn.id)
        & (Task.lifecycle == "on_board")
        & (Task.deleted_at.is_(None))
    )
    if user.role != "super_admin":
        cond = cond & (Task.department_id == user.department_id)
    col_stmt = (
        select(BoardColumn.id, BoardColumn.name, func.count(Task.id))
        .select_from(BoardColumn)
        .outerjoin(Task, cond)
        .group_by(BoardColumn.id, BoardColumn.name, BoardColumn.position)
        .order_by(BoardColumn.position)
    )
    if board_id is not None:
        col_stmt = col_stmt.where(BoardColumn.board_id == board_id)

    by_column = [
        {"column_id": cid, "name": name, "count": count}
        for cid, name, count in db.execute(col_stmt).all()
    ]

    pool_stmt = _dept_scope(
        select(func.count(Task.id)).where(
            Task.lifecycle == "open", Task.deleted_at.is_(None)
        ),
        user,
    )
    if board_id is not None:
        pool_stmt = pool_stmt.where(Task.board_id == board_id)
    pool_count = db.scalar(pool_stmt) or 0

    # overdue: due_date < now, not in a done column, not finished
    done_col_ids = select(BoardColumn.id).where(BoardColumn.kind == DONE_KIND)
    overdue_stmt = _dept_scope(
        select(func.count(Task.id)).where(
            Task.lifecycle == "on_board",
            Task.deleted_at.is_(None),
            Task.due_date.is_not(None),
            Task.due_date < now,
            Task.column_id.not_in(done_col_ids),
        ),
        user,
    )
    if board_id is not None:
        overdue_stmt = overdue_stmt.where(Task.board_id == board_id)
    overdue_count = db.scalar(overdue_stmt) or 0

    return {
        "by_column": by_column,
        "pool_count": pool_count,
        "overdue_count": overdue_count,
    }


@router.get("/stats/members")
def members(
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    done_col_ids = select(BoardColumn.id).where(BoardColumn.kind == DONE_KIND)
    review_col_ids = select(BoardColumn.id).where(BoardColumn.kind == REVIEW_KIND)

    user_stmt = select(User).where(
        User.is_active.is_(True),
        User.account_status == "active",
        User.role.in_(("admin", "member")),
    )
    if user.role != "super_admin":
        user_stmt = user_stmt.where(User.department_id == user.department_id)
    people = db.scalars(user_stmt.order_by(User.full_name)).all()

    results = []
    for p in people:
        base = select(func.count(Task.id)).where(
            Task.assignee_id == p.id,
            Task.lifecycle == "on_board",
            Task.deleted_at.is_(None),
        )
        total = db.scalar(base) or 0
        done = db.scalar(base.where(Task.column_id.in_(done_col_ids))) or 0
        in_review = db.scalar(base.where(Task.column_id.in_(review_col_ids))) or 0
        overdue = (
            db.scalar(
                base.where(
                    Task.due_date.is_not(None),
                    Task.due_date < now,
                    Task.column_id.not_in(done_col_ids),
                )
            )
            or 0
        )
        results.append(
            {
                "user": UserOut.model_validate(p).model_dump(),
                "total": total,
                "done": done,
                "in_review": in_review,
                "overdue": overdue,
            }
        )
    return results
