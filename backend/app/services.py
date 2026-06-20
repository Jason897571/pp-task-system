"""Shared business helpers: board visibility, column lookups, activity audit."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import BoardColumn, BoardVisibility, Task, TaskActivity, User


def visible_board_ids(db: Session, user: User) -> set[int] | None:
    """Board ids the user may see.

    Returns None to mean "all boards" (super_admin). For admin/member, a board
    is visible if it has no BoardVisibility rows (visible to all) OR a row for
    the user's department.
    """
    if user.role == "super_admin":
        return None

    all_board_ids = set(db.scalars(select(BoardColumn.board_id)).all())
    # also include boards with no columns
    from app.models import Board

    all_board_ids |= set(db.scalars(select(Board.id)).all())

    restricted = {
        bid for (bid,) in db.execute(select(BoardVisibility.board_id).distinct()).all()
    }
    dept_boards = set()
    if user.department_id is not None:
        dept_boards = {
            bid
            for (bid,) in db.execute(
                select(BoardVisibility.board_id).where(
                    BoardVisibility.department_id == user.department_id
                )
            ).all()
        }

    visible = set()
    for bid in all_board_ids:
        if bid not in restricted or bid in dept_boards:
            visible.add(bid)
    return visible


def board_can_see(db: Session, user: User, board_id: int) -> bool:
    ids = visible_board_ids(db, user)
    return ids is None or board_id in ids


def first_column(db: Session, board_id: int) -> BoardColumn | None:
    return db.scalars(
        select(BoardColumn)
        .where(BoardColumn.board_id == board_id)
        .order_by(BoardColumn.position)
        .limit(1)
    ).first()


def start_column(db: Session, board_id: int) -> BoardColumn | None:
    col = db.scalars(
        select(BoardColumn)
        .where(BoardColumn.board_id == board_id, BoardColumn.kind == "start")
        .order_by(BoardColumn.position)
        .limit(1)
    ).first()
    return col or first_column(db, board_id)


def column_of_kind(db: Session, board_id: int, kind: str) -> BoardColumn | None:
    return db.scalars(
        select(BoardColumn)
        .where(BoardColumn.board_id == board_id, BoardColumn.kind == kind)
        .order_by(BoardColumn.position)
        .limit(1)
    ).first()


def log_activity(
    db: Session, task: Task, actor: User, action: str, comment: str | None = None
) -> None:
    db.add(
        TaskActivity(task_id=task.id, actor_id=actor.id, action=action, comment=comment)
    )


def admin_can_touch_task(user: User, task: Task) -> bool:
    """admin scope: own department + tasks created/participated in."""
    if user.role == "super_admin":
        return True
    if user.role != "admin":
        return False
    if task.department_id is not None and task.department_id == user.department_id:
        return True
    if task.creator_id == user.id or task.assignee_id == user.id:
        return True
    return False
