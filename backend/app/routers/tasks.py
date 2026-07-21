from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import get_current_user, require_admin
from app.feishu import build_task_card, post_bot_card
from app.models import (
    Board,
    BoardColumn,
    Deliverable,
    Task,
    TaskLink,
    User,
)
from app.schemas import (
    ApproveIn,
    AssignIn,
    CommentIn,
    CommentOut,
    LinkedTaskOut,
    LinkIn,
    MoveBoardIn,
    MoveIn,
    ReviewIn,
    SubmitIn,
    TaskDetailOut,
    TaskIn,
    TaskOut,
    TaskUpdateIn,
    UserOut,
)
from app.services import (
    admin_can_touch_task,
    apply_assignee,
    board_can_see,
    can_edit_task,
    column_of_kind,
    copy_requirement_children,
    final_column,
    hard_delete_task,
    log_activity,
    notify,
    review_admin_for,
    review_column,
    serialize_linked_task,
    serialize_task,
    serialize_task_detail,
    stamp_completion,
    start_column,
    visible_board_ids,
)

router = APIRouter(prefix="/api", tags=["tasks"])


_SHANGHAI = ZoneInfo("Asia/Shanghai")


def _due_text(task: Task) -> str | None:
    """Format a task's naive-UTC due_date as a local (Asia/Shanghai) yyyy-mm-dd."""
    if task.due_date is None:
        return None
    return task.due_date.replace(tzinfo=timezone.utc).astimezone(_SHANGHAI).strftime("%Y-%m-%d")


def _feishu_task_card(
    task: Task, mention: User | None, header: str, footer: str, extra: str | None = None
) -> None:
    """Post a task card (title / DDL / priority / detail, @-mentioning `mention`)
    to the group bot. `extra` appends one more body line (e.g. a comment)."""
    card = build_task_card(
        header=header,
        footer=footer,
        title=task.title,
        priority=task.priority,
        due_date=_due_text(task),
        description=task.description,
        assignee_open_id=mention.feishu_open_id if mention else None,
        assignee_name=mention.full_name if mention else None,
        extra=extra,
        link_url=f"{settings.app_base_url.rstrip('/')}/board/{task.board_id}/card/{task.id}",
    )
    post_bot_card(settings.feishu_bot_webhook, card)


def _name(user: User | None) -> str:
    return user.full_name if user else "某人"


def _column_kind(db: Session, task: Task) -> str | None:
    if task.column_id is None:
        return None
    col = db.get(BoardColumn, task.column_id)
    return col.kind if col else None


def _visible_to(db: Session, user: User, task: Task) -> bool:
    if user.role == "super_admin":
        return True
    if user.role == "admin":
        if admin_can_touch_task(user, task):
            return True
    elif task.assignee_id == user.id or task.creator_id == user.id:
        # member: own assigned/self-submitted tasks
        return True
    # anyone may view an open pool task within their visible board + department
    # (needed to open the detail before applying); mirrors the /pool filter.
    if (
        task.lifecycle == "open"
        and task.department_id == user.department_id
        and board_can_see(db, user, task.board_id)
    ):
        return True
    return False


@router.get("/tasks", response_model=list[TaskOut])
def list_tasks(
    board_id: int | None = Query(default=None),
    assignee: int | None = Query(default=None),
    lifecycle: str | None = Query(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    stmt = select(Task).where(Task.deleted_at.is_(None))
    # default to on-board tasks
    stmt = stmt.where(Task.lifecycle == (lifecycle or "on_board"))
    if board_id is not None:
        stmt = stmt.where(Task.board_id == board_id)
    if assignee is not None:
        stmt = stmt.where(Task.assignee_id == assignee)

    # board visibility scope
    ids = visible_board_ids(db, user)
    if ids is not None:
        stmt = stmt.where(Task.board_id.in_(ids))

    rows = db.scalars(stmt.order_by(Task.id)).all()
    rows = [t for t in rows if _visible_to(db, user, t)]
    return [serialize_task(db, t) for t in rows]


@router.post("/tasks", response_model=TaskOut)
def create_task(
    body: TaskIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    board = db.get(Board, body.board_id)
    if board is None:
        raise HTTPException(status_code=404, detail="看板不存在")
    if not board_can_see(db, user, body.board_id):
        raise HTTPException(status_code=403, detail="无权在该看板建任务")

    priority = body.priority or "normal"
    department_id = body.department_id if body.department_id is not None else user.department_id

    task = Task(
        title=body.title,
        description=body.description,
        creator_id=user.id,
        board_id=body.board_id,
        department_id=department_id,
        priority=priority,
        due_date=body.due_date,
    )

    if user.role == "member":
        # Members add tasks straight onto the board, assigned to themselves — no approval.
        col = start_column(db, body.board_id)
        if col is None:
            raise HTTPException(status_code=409, detail="看板没有可用的起始列")
        apply_assignee(task, user)
        task.lifecycle = "on_board"
        task.column_id = col.id
    elif body.assignee_id is not None:
        assignee = db.get(User, body.assignee_id)
        if assignee is None:
            raise HTTPException(status_code=404, detail="接收人不存在")
        col = start_column(db, body.board_id)
        if col is None:
            raise HTTPException(status_code=409, detail="看板没有可用的起始列")
        apply_assignee(task, assignee)
        task.lifecycle = "on_board"
        task.column_id = col.id
        db.add(task)
        db.flush()
        log_activity(db, task, user, "assigned")
        notify(db, assignee.id, "assigned", f"你被指派了任务「{task.title}」", task.id)
    else:
        # admin/super w/o assignee -> open pool. The pool is department-scoped, so
        # a department-less task would be invisible to everyone but super_admin.
        # admins inherit their own department above; super_admin has none and must
        # pick one explicitly.
        if department_id is None:
            raise HTTPException(status_code=400, detail="需求池任务需要指定部门")
        task.lifecycle = "open"
        task.assignee_id = None
        task.column_id = None

    if task.id is None:
        db.add(task)
    db.commit()
    db.refresh(task)
    return serialize_task(db, task)


@router.get("/tasks/{task_id}", response_model=TaskDetailOut)
def get_task(
    task_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = db.get(Task, task_id)
    if task is None or task.deleted_at is not None:
        raise HTTPException(status_code=404, detail="任务不存在")
    if not _visible_to(db, user, task):
        raise HTTPException(status_code=403, detail="无权查看该任务")
    return serialize_task_detail(db, task)


@router.put("/tasks/{task_id}", response_model=TaskDetailOut)
def update_task(
    task_id: int,
    body: TaskUpdateIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Edit task details (title / description / priority / due date). Editable by
    a scoped admin/super or the task's assignee."""
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    if not can_edit_task(user, task):
        raise HTTPException(status_code=403, detail="无权编辑该任务")
    data = body.model_dump(exclude_unset=True)
    if "title" in data and data["title"] is not None:
        task.title = data["title"]
    if "description" in data:
        task.description = data["description"]
    if "priority" in data and data["priority"] is not None:
        task.priority = data["priority"]
    if "due_date" in data:
        task.due_date = data["due_date"]
    db.commit()
    db.refresh(task)
    return serialize_task_detail(db, task)


@router.post("/tasks/{task_id}/assign", response_model=TaskOut)
def assign_task(
    task_id: int,
    body: AssignIn,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    if not admin_can_touch_task(user, task):
        raise HTTPException(status_code=403, detail="无权操作该任务")
    if task.lifecycle == "declined":
        raise HTTPException(status_code=409, detail="任务已被拒绝，无法指派")

    assignee = db.get(User, body.assignee_id)
    if assignee is None:
        raise HTTPException(status_code=404, detail="接收人不存在")

    is_reassign = task.lifecycle == "on_board" and task.assignee_id is not None
    col = start_column(db, task.board_id)
    if col is None:
        raise HTTPException(status_code=409, detail="看板没有可用的起始列")

    was_open = task.lifecycle == "open"
    apply_assignee(task, assignee)
    task.lifecycle = "on_board"
    if was_open or task.column_id is None:
        task.column_id = col.id

    log_activity(db, task, user, "reassigned" if is_reassign else "assigned")
    notify(db, assignee.id, "assigned", f"你被指派了任务「{task.title}」", task.id)
    db.commit()
    db.refresh(task)
    return serialize_task(db, task)


@router.post("/tasks/{task_id}/to-pool", response_model=TaskOut)
def task_to_pool(
    task_id: int,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Send an on-board task back to the pool: clear assignee + column, keep the
    board, flip lifecycle to open so anyone can pick it up again."""
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    if not admin_can_touch_task(user, task):
        raise HTTPException(status_code=403, detail="无权操作该任务")
    if task.lifecycle != "on_board":
        raise HTTPException(status_code=409, detail="只有看板上的任务可以放入需求池")

    former_assignee_id = task.assignee_id
    task.lifecycle = "open"
    task.assignee_id = None
    task.column_id = None
    log_activity(db, task, user, "to_pool")
    if former_assignee_id is not None:
        notify(
            db,
            former_assignee_id,
            "to_pool",
            f"任务「{task.title}」已被放回需求池",
            task.id,
        )
    db.commit()
    db.refresh(task)
    return serialize_task(db, task)


@router.post("/tasks/{task_id}/approve", response_model=TaskOut)
def approve_task(
    task_id: int,
    body: ApproveIn,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    if not admin_can_touch_task(user, task):
        raise HTTPException(status_code=403, detail="无权操作该任务")
    if task.lifecycle != "pending_approval":
        raise HTTPException(status_code=409, detail="任务不处于待审批状态")

    if not body.approve:
        task.lifecycle = "declined"
        task.column_id = None
        # A rejected self-submission is moved to the recycle bin (recoverable),
        # so it isn't silently lost, and its creator is told why.
        task.deleted_at = datetime.now(timezone.utc).replace(tzinfo=None)
        log_activity(db, task, user, "rejected")
        notify(db, task.creator_id, "rejected", f"你提交的需求「{task.title}」未通过审批", task.id)
        db.commit()
        db.refresh(task)
        _feishu_task_card(task, task.creator, "🚫 需求被拒绝", f"审批人：{_name(user)}")
        return serialize_task(db, task)

    if body.assignee_id is None:
        raise HTTPException(status_code=400, detail="通过审批必须指派接收人")
    assignee = db.get(User, body.assignee_id)
    if assignee is None:
        raise HTTPException(status_code=404, detail="接收人不存在")
    col = start_column(db, task.board_id)
    if col is None:
        raise HTTPException(status_code=409, detail="看板没有可用的起始列")

    apply_assignee(task, assignee)
    task.lifecycle = "on_board"
    task.column_id = col.id
    log_activity(db, task, user, "approved")
    log_activity(db, task, user, "assigned")
    notify(db, assignee.id, "assigned", f"你被指派了任务「{task.title}」", task.id)
    db.commit()
    db.refresh(task)
    return serialize_task(db, task)


@router.post("/tasks/{task_id}/move", response_model=TaskOut)
def move_task(
    task_id: int,
    body: MoveIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    if task.lifecycle != "on_board":
        raise HTTPException(status_code=409, detail="任务未上板，无法移动")

    col = db.get(BoardColumn, body.column_id)
    if col is None:
        raise HTTPException(status_code=404, detail="列不存在")
    if col.board_id != task.board_id:
        raise HTTPException(status_code=400, detail="目标列不属于该看板")

    if user.role == "member":
        if task.assignee_id != user.id:
            raise HTTPException(status_code=403, detail="只能移动自己的任务")
        # Completion must pass review only when the board has a review gate.
        if col.kind == "done" and review_column(db, task.board_id) is not None:
            raise HTTPException(status_code=403, detail="需经审核后才能完成")
    elif not admin_can_touch_task(user, task):
        raise HTTPException(status_code=403, detail="无权移动该任务")

    prev_col_id = task.column_id
    task.column_id = col.id
    stamp_completion(task, col, prev_col_id)
    db.commit()
    db.refresh(task)
    return serialize_task(db, task)


@router.post("/tasks/{task_id}/move-to-board", response_model=TaskOut)
def move_task_to_board(
    task_id: int,
    body: MoveBoardIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Restore an archived card to another board (admin/super only)."""
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    if user.role not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="无权放回该任务")
    if not admin_can_touch_task(user, task):
        raise HTTPException(status_code=403, detail="无权放回该任务")

    board = db.get(Board, body.board_id)
    if board is None or not board_can_see(db, user, body.board_id):
        raise HTTPException(status_code=404, detail="目标看板不存在")
    col = db.get(BoardColumn, body.column_id)
    if col is None or col.board_id != body.board_id:
        raise HTTPException(status_code=400, detail="目标列不属于该看板")

    prev_col_id = task.column_id
    task.board_id = board.id
    task.column_id = col.id
    task.archived_at = None  # leaving the archive board clears its archive time
    stamp_completion(task, col, prev_col_id)
    db.commit()
    db.refresh(task)
    return serialize_task(db, task)


@router.post("/tasks/{task_id}/restore-to-origin", response_model=TaskOut)
def restore_to_origin(
    task_id: int,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """One-click restore of an archived card back to its ORIGIN board's final-
    acceptance column (the card was archived from there). Falls back to the origin
    board's start column if it no longer has a final column. admin/super only."""
    task = db.get(Task, task_id)
    if task is None or task.deleted_at is not None:
        raise HTTPException(status_code=404, detail="任务不存在")
    if not admin_can_touch_task(user, task):
        raise HTTPException(status_code=403, detail="无权放回该任务")
    if task.archived_at is None:
        raise HTTPException(status_code=409, detail="任务不在归档看板")

    # The archive column records where the card came from via source_board_id.
    arc_col = db.get(BoardColumn, task.column_id) if task.column_id else None
    origin_id = arc_col.source_board_id if arc_col else None
    origin = db.get(Board, origin_id) if origin_id else None
    if origin is None:
        raise HTTPException(status_code=409, detail="原看板已删除，无法放回")

    target = final_column(db, origin.id) or start_column(db, origin.id)
    if target is None:
        raise HTTPException(status_code=409, detail="原看板没有可用的列")

    prev_col_id = task.column_id
    task.board_id = origin.id
    task.column_id = target.id
    task.archived_at = None
    stamp_completion(task, target, prev_col_id)
    db.commit()
    db.refresh(task)
    return serialize_task(db, task)


@router.post("/tasks/{task_id}/start", response_model=TaskOut)
def start_task(
    task_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    if task.assignee_id != user.id:
        raise HTTPException(status_code=403, detail="只能开始自己的任务")
    if _column_kind(db, task) != "start":
        raise HTTPException(status_code=409, detail="任务不在起始列")
    doing = column_of_kind(db, task.board_id, "doing")
    if doing is None:
        raise HTTPException(status_code=409, detail="看板没有进行中列")
    task.column_id = doing.id
    db.commit()
    db.refresh(task)
    return serialize_task(db, task)


@router.post("/tasks/{task_id}/submit", response_model=TaskOut)
def submit_task(
    task_id: int,
    body: SubmitIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    if task.assignee_id != user.id and not admin_can_touch_task(user, task):
        raise HTTPException(status_code=403, detail="无权提交该任务的产出")
    if _column_kind(db, task) != "doing":
        raise HTTPException(status_code=409, detail="任务不在进行中列")

    db.add(Deliverable(task_id=task.id, submitter_id=user.id, note=body.note))
    review = review_column(db, task.board_id)
    if review is not None:
        # Board has a review gate → card waits for admin approval.
        task.column_id = review.id
        task.is_rework = False
        log_activity(db, task, user, "submitted", comment=body.note)
        reviewer = review_admin_for(db, task)
        if reviewer is not None:
            notify(db, reviewer.id, "submitted", f"任务「{task.title}」已提交待审核", task.id)
    else:
        # No review needed → submission completes the task straight away.
        done = column_of_kind(db, task.board_id, "done")
        if done is None:
            raise HTTPException(status_code=409, detail="看板没有完成列")
        prev_col_id = task.column_id
        task.column_id = done.id
        stamp_completion(task, done, prev_col_id)
        task.is_rework = False
        log_activity(db, task, user, "submitted", comment=body.note)
    db.commit()
    db.refresh(task)
    if review is not None:
        _feishu_task_card(task, task.creator, "🔍 待审核", f"提交人：{_name(user)}")
    return serialize_task(db, task)


@router.post("/tasks/{task_id}/review", response_model=TaskOut)
def review_task(
    task_id: int,
    body: ReviewIn,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    if not admin_can_touch_task(user, task):
        raise HTTPException(status_code=403, detail="无权审核该任务")
    cur_col = db.get(BoardColumn, task.column_id) if task.column_id else None
    if cur_col is None or not cur_col.requires_review:
        raise HTTPException(status_code=409, detail="任务不在待审核列")

    if body.approve:
        done = column_of_kind(db, task.board_id, "done")
        if done is None:
            raise HTTPException(status_code=409, detail="看板没有完成列")
        prev_col_id = task.column_id
        task.column_id = done.id
        stamp_completion(task, done, prev_col_id)
        task.is_rework = False
        log_activity(db, task, user, "approved")
        if task.assignee_id is not None:
            notify(db, task.assignee_id, "reviewed", f"任务「{task.title}」已通过审核", task.id)
    else:
        if not body.comment:
            raise HTTPException(status_code=400, detail="打回必须填写原因")
        doing = column_of_kind(db, task.board_id, "doing")
        if doing is None:
            raise HTTPException(status_code=409, detail="看板没有进行中列")
        task.column_id = doing.id
        task.is_rework = True
        log_activity(db, task, user, "rejected", comment=body.comment)
        if task.assignee_id is not None:
            notify(db, task.assignee_id, "reviewed", f"任务「{task.title}」被打回：{body.comment}", task.id)

    db.commit()
    db.refresh(task)
    return serialize_task(db, task)


@router.post("/tasks/{task_id}/push-feishu")
def push_task_to_feishu(
    task_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Manually push the task as a card to the Feishu group. Pushable by a scoped
    admin/super or the task's assignee. Best-effort: the card is fired in the
    background, so this always returns ok."""
    task = db.get(Task, task_id)
    if task is None or task.deleted_at is not None:
        raise HTTPException(status_code=404, detail="任务不存在")
    if not can_edit_task(user, task):
        raise HTTPException(status_code=403, detail="无权推送该任务")
    _feishu_task_card(task, task.assignee, "📌 任务推送", f"推送人：{_name(user)}")
    return {"ok": True}


@router.post("/tasks/{task_id}/comment", response_model=CommentOut)
def comment_task(
    task_id: int,
    body: CommentIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Anyone who can see the card may comment on it (admins, the assignee, the
    creator). The assignee is notified. Returns the new comment (with its id) so
    the client can attach files to it."""
    task = db.get(Task, task_id)
    if task is None or task.deleted_at is not None:
        raise HTTPException(status_code=404, detail="任务不存在")
    if not _visible_to(db, user, task):
        raise HTTPException(status_code=403, detail="无权评论该任务")
    text = body.comment.strip()
    if not text:
        raise HTTPException(status_code=400, detail="评论不能为空")
    act = log_activity(db, task, user, "commented", comment=text)
    # Notify the people involved (assignee + creator), minus the commenter.
    for uid in {task.assignee_id, task.creator_id} - {None, user.id}:
        notify(db, uid, "comment", f"任务「{task.title}」收到评论：{text}", task.id)
    db.commit()
    db.refresh(act)
    # Always push the comment to the group bot so it's visible to everyone;
    # @-mention the counterpart — if the commenter is the assignee, mention the
    # creator (admin), otherwise mention the assignee. No counterpart → post
    # the card without an @-mention.
    recipient = task.creator if user.id == task.assignee_id else task.assignee
    if recipient is not None and recipient.id == user.id:
        recipient = None
    snippet = text if len(text) <= 100 else text[:100] + "…"
    _feishu_task_card(
        task, recipient, "💬 新评论", f"评论人：{_name(user)}", extra=f"**💬 评论**　{snippet}"
    )
    return CommentOut(
        id=act.id,
        author=UserOut.model_validate(user),
        body=text,
        created_at=act.created_at,
        attachments=[],
    )


@router.post("/tasks/{task_id}/links", response_model=LinkedTaskOut)
def link_task(
    task_id: int,
    body: LinkIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Relate another task to this one (symmetric). Editors of the card (managers
    or the assignee) may link any task they can see. Returns the linked task."""
    task = db.get(Task, task_id)
    if task is None or task.deleted_at is not None:
        raise HTTPException(status_code=404, detail="任务不存在")
    if not can_edit_task(user, task):
        raise HTTPException(status_code=403, detail="无权关联该任务")
    if body.linked_task_id == task_id:
        raise HTTPException(status_code=400, detail="不能关联任务自身")
    other = db.get(Task, body.linked_task_id)
    if other is None or other.deleted_at is not None:
        raise HTTPException(status_code=404, detail="关联的任务不存在")
    if not _visible_to(db, user, other):
        raise HTTPException(status_code=403, detail="无权关联不可见的任务")
    a, b = sorted((task_id, other.id))
    exists = db.scalar(
        select(TaskLink).where(TaskLink.task_a_id == a, TaskLink.task_b_id == b)
    )
    if exists is None:
        db.add(TaskLink(task_a_id=a, task_b_id=b))
        db.commit()
    return serialize_linked_task(db, other)


@router.delete("/tasks/{task_id}/links/{linked_id}")
def unlink_task(
    task_id: int,
    linked_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Remove the relationship (symmetric — drops it from both cards)."""
    task = db.get(Task, task_id)
    if task is None or task.deleted_at is not None:
        raise HTTPException(status_code=404, detail="任务不存在")
    if not can_edit_task(user, task):
        raise HTTPException(status_code=403, detail="无权修改该任务的关联")
    a, b = sorted((task_id, linked_id))
    row = db.scalar(
        select(TaskLink).where(TaskLink.task_a_id == a, TaskLink.task_b_id == b)
    )
    if row is not None:
        db.delete(row)
        db.commit()
    return {"ok": True}


@router.post("/tasks/{task_id}/duplicate", response_model=TaskOut)
def duplicate_task(
    task_id: int,
    body: AssignIn,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Copy a card's requirement (title/desc/priority/deadline/attachments/checklists/
    tags) into a new on-board card assigned to body.assignee_id. The 产出 side
    (deliverables/comments/applications) is not copied."""
    src = db.get(Task, task_id)
    if src is None or src.deleted_at is not None:
        raise HTTPException(status_code=404, detail="任务不存在")
    if not admin_can_touch_task(user, src):
        raise HTTPException(status_code=403, detail="无权复制该任务")
    assignee = db.get(User, body.assignee_id)
    if assignee is None:
        raise HTTPException(status_code=404, detail="接收人不存在")
    col = start_column(db, src.board_id)
    if col is None:
        raise HTTPException(status_code=409, detail="看板没有可用的起始列")

    dst = Task(
        title=src.title,
        description=src.description,
        creator_id=user.id,
        assignee_id=assignee.id,
        department_id=(
            assignee.department_id if assignee.department_id is not None else src.department_id
        ),
        board_id=src.board_id,
        column_id=col.id,
        lifecycle="on_board",
        priority=src.priority,
        is_mandatory=src.is_mandatory,
        due_date=src.due_date,
    )
    db.add(dst)
    db.flush()
    copy_requirement_children(db, src, dst)
    log_activity(db, dst, user, "assigned")
    notify(db, assignee.id, "assigned", f"你被指派了任务「{dst.title}」", dst.id)
    db.commit()
    db.refresh(dst)
    return serialize_task(db, dst)


# ---- recycle bin (admin/super only) ----


@router.delete("/tasks/{task_id}")
def delete_task(
    task_id: int,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Soft-delete a card into the recycle bin."""
    task = db.get(Task, task_id)
    if task is None or task.deleted_at is not None:
        raise HTTPException(status_code=404, detail="任务不存在")
    if not admin_can_touch_task(user, task):
        raise HTTPException(status_code=403, detail="无权删除该任务")
    task.deleted_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()
    return {"ok": True}


@router.get("/trash", response_model=list[TaskOut])
def list_trash(
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Cards currently in the recycle bin, newest-deleted first."""
    rows = db.scalars(
        select(Task).where(Task.deleted_at.is_not(None)).order_by(Task.deleted_at.desc())
    ).all()
    rows = [t for t in rows if admin_can_touch_task(user, t)]
    return [serialize_task(db, t) for t in rows]


@router.post("/tasks/{task_id}/restore", response_model=TaskOut)
def restore_task(
    task_id: int,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Restore a card from the recycle bin back to its original board/column."""
    task = db.get(Task, task_id)
    if task is None or task.deleted_at is None:
        raise HTTPException(status_code=404, detail="回收箱中无此任务")
    if not admin_can_touch_task(user, task):
        raise HTTPException(status_code=403, detail="无权恢复该任务")
    task.deleted_at = None
    # A rejected task was trashed on decline; restoring it puts it back in the
    # approval queue instead of leaving it in the invisible "declined" state.
    if task.lifecycle == "declined":
        task.lifecycle = "pending_approval"
    db.commit()
    db.refresh(task)
    return serialize_task(db, task)


@router.delete("/tasks/{task_id}/purge")
def purge_task(
    task_id: int,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Permanently delete a card from the recycle bin (no 30-day wait)."""
    task = db.get(Task, task_id)
    if task is None or task.deleted_at is None:
        raise HTTPException(status_code=404, detail="回收箱中无此任务")
    if not admin_can_touch_task(user, task):
        raise HTTPException(status_code=403, detail="无权删除该任务")
    hard_delete_task(db, task)
    db.commit()
    return {"ok": True}
