from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, require_admin
from app.models import (
    Board,
    BoardColumn,
    Deliverable,
    Task,
    User,
)
from app.schemas import (
    ApproveIn,
    AssignIn,
    CommentIn,
    MoveBoardIn,
    MoveIn,
    ReviewIn,
    SubmitIn,
    TaskDetailOut,
    TaskIn,
    TaskOut,
    TaskUpdateIn,
)
from app.services import (
    admin_can_touch_task,
    board_can_see,
    column_of_kind,
    hard_delete_task,
    log_activity,
    notify,
    review_admin_for,
    review_column,
    serialize_task,
    serialize_task_detail,
    start_column,
    visible_board_ids,
)

router = APIRouter(prefix="/api", tags=["tasks"])


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
        # self-submit -> pending_approval, no column, no assignee
        task.lifecycle = "pending_approval"
        task.assignee_id = None
        task.column_id = None
    elif body.assignee_id is not None:
        assignee = db.get(User, body.assignee_id)
        if assignee is None:
            raise HTTPException(status_code=404, detail="接收人不存在")
        col = start_column(db, body.board_id)
        if col is None:
            raise HTTPException(status_code=409, detail="看板没有可用的起始列")
        task.assignee_id = assignee.id
        task.lifecycle = "on_board"
        task.column_id = col.id
        db.add(task)
        db.flush()
        log_activity(db, task, user, "assigned")
        notify(db, assignee.id, "assigned", f"你被指派了任务「{task.title}」", task.id)
    else:
        # admin w/o assignee -> open pool
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
    """Edit task details (title / description / priority / due date). admin/super
    (admin scoped to own department)."""
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    if not admin_can_touch_task(user, task):
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
    task.assignee_id = assignee.id
    task.lifecycle = "on_board"
    if was_open or task.column_id is None:
        task.column_id = col.id

    log_activity(db, task, user, "reassigned" if is_reassign else "assigned")
    notify(db, assignee.id, "assigned", f"你被指派了任务「{task.title}」", task.id)
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
        log_activity(db, task, user, "rejected")
        db.commit()
        db.refresh(task)
        return serialize_task(db, task)

    if body.assignee_id is None:
        raise HTTPException(status_code=400, detail="通过审批必须指派接收人")
    assignee = db.get(User, body.assignee_id)
    if assignee is None:
        raise HTTPException(status_code=404, detail="接收人不存在")
    col = start_column(db, task.board_id)
    if col is None:
        raise HTTPException(status_code=409, detail="看板没有可用的起始列")

    task.assignee_id = assignee.id
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

    task.column_id = col.id
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

    task.board_id = board.id
    task.column_id = col.id
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
        task.column_id = done.id
        task.is_rework = False
        log_activity(db, task, user, "submitted", comment=body.note)
    db.commit()
    db.refresh(task)
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
        task.column_id = done.id
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


@router.post("/tasks/{task_id}/comment", response_model=TaskOut)
def comment_task(
    task_id: int,
    body: CommentIn,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Admin/super leaves a comment on a card; the assignee is notified."""
    task = db.get(Task, task_id)
    if task is None or task.deleted_at is not None:
        raise HTTPException(status_code=404, detail="任务不存在")
    if not admin_can_touch_task(user, task):
        raise HTTPException(status_code=403, detail="无权评论该任务")
    text = body.comment.strip()
    if not text:
        raise HTTPException(status_code=400, detail="评论不能为空")
    log_activity(db, task, user, "commented", comment=text)
    if task.assignee_id is not None and task.assignee_id != user.id:
        notify(db, task.assignee_id, "comment", f"任务「{task.title}」收到评论：{text}", task.id)
    db.commit()
    db.refresh(task)
    return serialize_task(db, task)


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
