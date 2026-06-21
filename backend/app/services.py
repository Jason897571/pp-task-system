"""Shared business helpers: board visibility, column lookups, activity audit."""

from datetime import date, datetime, time, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    Attachment,
    Board,
    BoardColumn,
    BoardMemberVisibility,
    Checklist,
    ChecklistItem,
    Notification,
    RecurringTask,
    Task,
    TaskActivity,
    User,
)


def visible_board_ids(db: Session, user: User) -> set[int] | None:
    """Board ids the user may see.

    Returns None to mean "all boards" (super_admin). For admin/member, a board
    is visible if it has no BoardMemberVisibility rows (visible to all) OR a row
    for this user (per-user visibility matrix in 管理).
    """
    if user.role == "super_admin":
        return None

    all_board_ids = set(db.scalars(select(BoardColumn.board_id)).all())
    # also include boards with no columns
    all_board_ids |= set(db.scalars(select(Board.id)).all())

    restricted = {
        bid
        for (bid,) in db.execute(select(BoardMemberVisibility.board_id).distinct()).all()
    }
    user_boards = {
        bid
        for (bid,) in db.execute(
            select(BoardMemberVisibility.board_id).where(
                BoardMemberVisibility.user_id == user.id
            )
        ).all()
    }

    visible = set()
    for bid in all_board_ids:
        if bid not in restricted or bid in user_boards:
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


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------


def notify(
    db: Session,
    user_id: int,
    type: str,
    message: str,
    related_task_id: int | None = None,
) -> None:
    """Write an in-app notification row (does not commit)."""
    db.add(
        Notification(
            user_id=user_id,
            type=type,
            message=message,
            related_task_id=related_task_id,
        )
    )


def dept_admins(db: Session, department_id: int | None) -> list[User]:
    """Active admins of a department (for pool-apply / review routing)."""
    if department_id is None:
        return []
    return list(
        db.scalars(
            select(User).where(
                User.role == "admin",
                User.department_id == department_id,
                User.is_active.is_(True),
                User.account_status == "active",
            )
        ).all()
    )


def review_admin_for(db: Session, task: Task) -> User | None:
    """Pick one admin who can review a submitted task (own dept admin, else
    the creator if admin, else any super_admin)."""
    admins = dept_admins(db, task.department_id)
    if admins:
        return admins[0]
    creator = db.get(User, task.creator_id)
    if creator and creator.role in ("admin", "super_admin"):
        return creator
    return db.scalars(
        select(User).where(
            User.role == "super_admin",
            User.is_active.is_(True),
            User.account_status == "active",
        )
    ).first()


def can_edit_task(user: User, task: Task) -> bool:
    """Who may edit a task's tags/checklists/attachments: admin scope or assignee."""
    if admin_can_touch_task(user, task):
        return True
    return task.assignee_id == user.id


def attachments_for(db: Session, owner_type: str, owner_id: int) -> list[Attachment]:
    return list(
        db.scalars(
            select(Attachment)
            .where(
                Attachment.owner_type == owner_type,
                Attachment.owner_id == owner_id,
            )
            .order_by(Attachment.id)
        ).all()
    )


# ---------------------------------------------------------------------------
# Task serialization (round-2 adds computed tags / checklist_stats / attachments)
# ---------------------------------------------------------------------------


def _checklist_stats(db: Session, task: Task) -> dict:
    total = db.scalar(
        select(func.count(ChecklistItem.id))
        .join(Checklist, ChecklistItem.checklist_id == Checklist.id)
        .where(Checklist.task_id == task.id)
    ) or 0
    done = db.scalar(
        select(func.count(ChecklistItem.id))
        .join(Checklist, ChecklistItem.checklist_id == Checklist.id)
        .where(Checklist.task_id == task.id, ChecklistItem.is_done.is_(True))
    ) or 0
    return {"done": done, "total": total}


def serialize_task(db: Session, task: Task):
    """Build a TaskOut including computed tags + checklist_stats."""
    from app.schemas import TaskOut

    data = TaskOut.model_validate(task).model_dump()
    data["checklist_stats"] = _checklist_stats(db, task)
    return TaskOut.model_validate(data)


def serialize_task_detail(db: Session, task: Task):
    """Build a TaskDetailOut: Task fields + deliverables(+attachments)/applications/
    checklists/attachments."""
    from app.schemas import AttachmentOut, DeliverableOut, TaskDetailOut

    base = serialize_task(db, task).model_dump()

    deliverables = []
    for d in task.deliverables:
        dd = DeliverableOut.model_validate(d).model_dump()
        dd["attachments"] = [
            AttachmentOut.model_validate(a).model_dump()
            for a in attachments_for(db, "deliverable", d.id)
        ]
        deliverables.append(dd)

    base["deliverables"] = deliverables
    base["applications"] = list(task.applications)
    base["checklists"] = list(task.checklists)
    base["attachments"] = [
        AttachmentOut.model_validate(a).model_dump()
        for a in attachments_for(db, "task", task.id)
    ]
    return TaskDetailOut.model_validate(base)


# ---------------------------------------------------------------------------
# Recurring tasks
# ---------------------------------------------------------------------------

DEFAULT_BOARD_NAME = "任务看板"


def this_week_friday_1800(today: date) -> datetime:
    """Friday 18:00 of the week containing `today` (Monday-based week)."""
    friday = today + timedelta(days=(4 - today.weekday()))
    return datetime.combine(friday, time(18, 0))


def _default_board(db: Session) -> Board | None:
    board = db.scalars(
        select(Board).where(Board.name == DEFAULT_BOARD_NAME)
    ).first()
    if board is None:
        board = db.scalars(select(Board).order_by(Board.position, Board.id)).first()
    return board


def _instance_exists(db: Session, template: RecurringTask, assignee_id: int, due: datetime) -> bool:
    """Idempotency: one instance per template+assignee per week."""
    return (
        db.scalar(
            select(func.count(Task.id)).where(
                Task.recurring_task_id == template.id,
                Task.assignee_id == assignee_id,
                Task.due_date == due,
            )
        )
        or 0
    ) > 0


def generate_recurring_instances(
    db: Session, today: date, template: RecurringTask | None = None
) -> int:
    """Pure-ish generator: create one mandatory Task per assignee for due templates.

    - When `template` is given (run-now), ignore the day-of-week check.
    - Otherwise process all active templates whose day_of_week == today.weekday().
    - Each instance lands in the default board's start column, lifecycle=on_board,
      is_mandatory=True, recurring_task_id set, due = this week's Friday 18:00.
    Returns the number of Task rows created. Does not commit.
    """
    if template is not None:
        templates = [template]
    else:
        templates = list(
            db.scalars(
                select(RecurringTask).where(
                    RecurringTask.is_active.is_(True),
                    RecurringTask.day_of_week == today.weekday(),
                )
            ).all()
        )

    board = _default_board(db)
    if board is None:
        return 0
    col = start_column(db, board.id)
    if col is None:
        return 0

    due = this_week_friday_1800(today)
    created = 0
    for tpl in templates:
        for assignee in tpl.assignees:
            if _instance_exists(db, tpl, assignee.id, due):
                continue
            db.add(
                Task(
                    title=tpl.title,
                    description=tpl.description,
                    creator_id=tpl.creator_id,
                    assignee_id=assignee.id,
                    department_id=tpl.department_id,
                    board_id=board.id,
                    column_id=col.id,
                    lifecycle="on_board",
                    priority=tpl.priority,
                    is_mandatory=True,
                    recurring_task_id=tpl.id,
                    due_date=due,
                )
            )
            created += 1
    return created
