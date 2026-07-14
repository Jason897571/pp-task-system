"""Shared business helpers: board visibility, column lookups, activity audit."""

import shutil
import uuid
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models import (
    Attachment,
    Board,
    BoardColumn,
    BoardMemberVisibility,
    Checklist,
    ChecklistItem,
    Deliverable,
    Notification,
    RecurringTask,
    Task,
    TaskActivity,
    TaskApplication,
    TaskLink,
    TaskTag,
    User,
)

# Cards stay in the recycle bin this long before being purged for good.
TRASH_RETENTION_DAYS = 30


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


def final_column(db: Session, board_id: int) -> BoardColumn | None:
    """The board's final-acceptance column (super_admin toggles is_final). None if
    the board has no such column."""
    return db.scalars(
        select(BoardColumn)
        .where(BoardColumn.board_id == board_id, BoardColumn.is_final.is_(True))
        .order_by(BoardColumn.position)
        .limit(1)
    ).first()


def review_column(db: Session, board_id: int) -> BoardColumn | None:
    """The board's single review gate (super_admin toggles requires_review).
    None means this board has no review step."""
    return db.scalars(
        select(BoardColumn)
        .where(BoardColumn.board_id == board_id, BoardColumn.requires_review.is_(True))
        .order_by(BoardColumn.position)
        .limit(1)
    ).first()


def log_activity(
    db: Session, task: Task, actor: User, action: str, comment: str | None = None
) -> TaskActivity:
    act = TaskActivity(task_id=task.id, actor_id=actor.id, action=action, comment=comment)
    db.add(act)
    return act


def apply_assignee(task: Task, assignee: User) -> None:
    """Attach an assignee to a task and make the task belong to that assignee's
    department. A task's owning department follows whoever is responsible for it,
    so the assignee's department admins keep it in scope (admin_can_touch_task is
    department-scoped). Without this, a task assigned/reassigned across departments
    — or one created by a super_admin (no department) — becomes invisible to the
    managing admin after a hand-off."""
    task.assignee_id = assignee.id
    if assignee.department_id is not None:
        task.department_id = assignee.department_id


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


def copy_requirement_children(db: Session, src: Task, dst: Task) -> None:
    """Copy a task's requirement-side children onto dst: checklists (+items, with
    done state reset), tags, and requirement attachments (files duplicated on disk).
    Deliverables / comments / applications are intentionally NOT copied. No commit."""
    for cl in src.checklists:
        new_cl = Checklist(task_id=dst.id, title=cl.title, position=cl.position)
        db.add(new_cl)
        db.flush()
        for it in cl.items:
            db.add(
                ChecklistItem(
                    checklist_id=new_cl.id,
                    content=it.content,
                    position=it.position,
                    is_done=False,
                )
            )

    for tag in src.tags:
        db.add(TaskTag(task_id=dst.id, tag_id=tag.id))

    for att in attachments_for(db, "task", src.id):
        path = Path(att.filepath)
        if not path.exists():
            continue
        dest = path.parent / f"{uuid.uuid4().hex}-{att.filename}"
        try:
            shutil.copyfile(path, dest)
        except OSError:
            continue
        db.add(
            Attachment(
                owner_type="task",
                owner_id=dst.id,
                uploader_id=att.uploader_id,
                filename=att.filename,
                filepath=str(dest),
                filesize=att.filesize,
                content_type=att.content_type,
            )
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


def task_status_label(task: Task, col: BoardColumn | None) -> str:
    """Human status for the related-task popup / exports."""
    if task.lifecycle == "open":
        return "待认领"
    if task.lifecycle == "pending_approval":
        return "待审批"
    if task.lifecycle == "declined":
        return "已放弃"
    if col is not None and (col.kind == "done" or col.is_final):
        return "已完成"
    return col.name if col and col.name else "进行中"


def linked_tasks(db: Session, task_id: int) -> list[Task]:
    """All tasks linked to this one (either direction), excluding trashed cards."""
    rows = db.scalars(
        select(TaskLink).where(
            (TaskLink.task_a_id == task_id) | (TaskLink.task_b_id == task_id)
        )
    ).all()
    other_ids = [r.task_b_id if r.task_a_id == task_id else r.task_a_id for r in rows]
    if not other_ids:
        return []
    return list(
        db.scalars(
            select(Task)
            .where(Task.id.in_(other_ids), Task.deleted_at.is_(None))
            .order_by(Task.id)
        ).all()
    )


def serialize_linked_task(db: Session, t: Task) -> dict:
    from app.schemas import LinkedTaskOut, UserOut

    board = db.get(Board, t.board_id)
    col = db.get(BoardColumn, t.column_id) if t.column_id else None
    return LinkedTaskOut(
        id=t.id,
        title=t.title,
        lifecycle=t.lifecycle,
        status=task_status_label(t, col),
        board=board.name if board else None,
        column=col.name if col else None,
        assignee=UserOut.model_validate(t.assignee) if t.assignee else None,
        priority=t.priority,
        due_date=t.due_date,
    ).model_dump()


def serialize_task_detail(db: Session, task: Task):
    """Build a TaskDetailOut: Task fields + deliverables(+attachments)/applications/
    checklists/attachments/comments/links."""
    from app.schemas import AttachmentOut, CommentOut, DeliverableOut, TaskDetailOut, UserOut

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

    # Comments are the "commented" entries of the activity log, oldest first.
    acts = db.scalars(
        select(TaskActivity)
        .where(TaskActivity.task_id == task.id, TaskActivity.action == "commented")
        .order_by(TaskActivity.created_at, TaskActivity.id)
    ).all()
    comments = []
    for a in acts:
        author = db.get(User, a.actor_id)
        comments.append(
            CommentOut(
                id=a.id,
                author=UserOut.model_validate(author),
                body=a.comment or "",
                created_at=a.created_at,
                attachments=[
                    AttachmentOut.model_validate(att)
                    for att in attachments_for(db, "comment", a.id)
                ],
            ).model_dump()
        )
    base["comments"] = comments
    base["links"] = [serialize_linked_task(db, lt) for lt in linked_tasks(db, task.id)]
    return TaskDetailOut.model_validate(base)


# ---------------------------------------------------------------------------
# Recurring tasks
# ---------------------------------------------------------------------------

DEFAULT_BOARD_NAME = "任务看板"
ARCHIVE_BOARD_NAME = "归档看板"


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


# ---------------------------------------------------------------------------
# Archive: weekly sweep of completed cards into the global archive board
# ---------------------------------------------------------------------------


def get_or_create_archive_board(db: Session) -> Board:
    """The single global 归档看板. Columns are created per source board on demand.

    Visible to everyone (no member-visibility rows). Does not commit."""
    board = db.scalars(select(Board).where(Board.is_archive.is_(True))).first()
    if board is None:
        max_pos = db.scalar(select(func.max(Board.position))) or 0
        board = Board(name=ARCHIVE_BOARD_NAME, position=max_pos + 1, is_archive=True)
        db.add(board)
        db.flush()
    return board


def get_or_create_archive_column(db: Session, archive: Board, source: Board) -> BoardColumn:
    """Find (or create) the archive-board column that holds `source`'s archived
    cards. Its name tracks the source board's current name. Does not commit."""
    col = db.scalars(
        select(BoardColumn).where(
            BoardColumn.board_id == archive.id,
            BoardColumn.source_board_id == source.id,
        )
    ).first()
    if col is None:
        col = BoardColumn(
            board_id=archive.id,
            name=source.name,
            position=source.position,
            source_board_id=source.id,
        )
        db.add(col)
        db.flush()
    else:
        col.name = source.name  # keep in sync if the board was renamed
    return col


def stamp_completion(task: Task, new_col: BoardColumn | None, prev_col_id: int | None) -> None:
    """Record the completion time when a card enters the final-acceptance (is_final)
    column. Overwrites on re-entry; only fires when the column actually changed.
    Statistics only. Call after assigning task.column_id (passing the old id)."""
    if new_col is not None and new_col.is_final and new_col.id != prev_col_id:
        task.completed_at = datetime.now(timezone.utc).replace(tzinfo=None)


def archive_completed_tasks(db: Session, today: date | None = None) -> int:
    """Sweep every on-board card sitting in an is_final column into the archive
    board, each under a column named after its origin board. Returns the number
    archived. Does not commit."""
    archive = get_or_create_archive_board(db)

    final_col_ids = set(
        db.scalars(select(BoardColumn.id).where(BoardColumn.is_final.is_(True))).all()
    )
    if not final_col_ids:
        return 0

    tasks = db.scalars(
        select(Task).where(
            Task.column_id.in_(final_col_ids),
            Task.board_id != archive.id,
            Task.deleted_at.is_(None),
        )
    ).all()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    count = 0
    for task in tasks:
        source = db.get(Board, task.board_id)
        if source is None:
            continue
        col = get_or_create_archive_column(db, archive, source)
        task.board_id = archive.id
        task.column_id = col.id
        task.archived_at = now
        count += 1
    return count


def hard_delete_task(db: Session, task: Task) -> None:
    """Permanently delete one task and all its dependent rows (FK-safe order).
    Does not commit."""
    tid = task.id
    deliverable_ids = list(
        db.scalars(select(Deliverable.id).where(Deliverable.task_id == tid)).all()
    )
    checklist_ids = list(
        db.scalars(select(Checklist.id).where(Checklist.task_id == tid)).all()
    )
    if checklist_ids:
        db.execute(delete(ChecklistItem).where(ChecklistItem.checklist_id.in_(checklist_ids)))
    db.execute(delete(Checklist).where(Checklist.task_id == tid))
    attach_cond = (Attachment.owner_type == "task") & (Attachment.owner_id == tid)
    if deliverable_ids:
        attach_cond = attach_cond | (
            (Attachment.owner_type == "deliverable")
            & (Attachment.owner_id.in_(deliverable_ids))
        )
    db.execute(delete(Attachment).where(attach_cond))
    db.execute(delete(Deliverable).where(Deliverable.task_id == tid))
    db.execute(delete(TaskApplication).where(TaskApplication.task_id == tid))
    db.execute(delete(TaskTag).where(TaskTag.task_id == tid))
    db.execute(delete(TaskActivity).where(TaskActivity.task_id == tid))
    db.execute(delete(Notification).where(Notification.related_task_id == tid))
    db.delete(task)


def purge_expired_trash(db: Session, now: datetime | None = None) -> int:
    """Hard-delete recycle-bin cards whose retention window has elapsed.
    Returns the number purged. Does not commit."""
    cutoff = (now or datetime.now(timezone.utc).replace(tzinfo=None)) - timedelta(
        days=TRASH_RETENTION_DAYS
    )
    expired = db.scalars(
        select(Task).where(Task.deleted_at.is_not(None), Task.deleted_at < cutoff)
    ).all()
    for task in expired:
        hard_delete_task(db, task)
    return len(expired)
