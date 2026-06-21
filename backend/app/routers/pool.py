from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, require_admin
from app.models import Task, TaskApplication, User
from app.schemas import ApplicationOut, TaskOut
from app.services import (
    admin_can_touch_task,
    board_can_see,
    dept_admins,
    notify,
    serialize_task,
    visible_board_ids,
)

router = APIRouter(prefix="/api", tags=["pool"])


@router.get("/pool", response_model=list[TaskOut])
def list_pool(
    board_id: int | None = Query(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    stmt = select(Task).where(Task.lifecycle == "open")
    if board_id is not None:
        stmt = stmt.where(Task.board_id == board_id)

    ids = visible_board_ids(db, user)
    if ids is not None:
        stmt = stmt.where(Task.board_id.in_(ids))

    rows = db.scalars(stmt.order_by(Task.id)).all()

    # department isolation: non-super users only see their department's pool
    if user.role != "super_admin":
        rows = [t for t in rows if t.department_id == user.department_id]

    return [serialize_task(db, t) for t in rows]


@router.post("/tasks/{task_id}/apply")
def apply_task(
    task_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.role != "member":
        raise HTTPException(status_code=403, detail="只有成员可以申请任务")
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    if task.lifecycle != "open":
        raise HTTPException(status_code=409, detail="任务不在任务池中")
    if not board_can_see(db, user, task.board_id) or task.department_id != user.department_id:
        raise HTTPException(status_code=403, detail="无权申请该任务")

    existing = db.scalars(
        select(TaskApplication).where(
            TaskApplication.task_id == task_id,
            TaskApplication.applicant_id == user.id,
        )
    ).first()
    if existing is None:
        db.add(TaskApplication(task_id=task_id, applicant_id=user.id))
        for admin in dept_admins(db, task.department_id):
            notify(
                db,
                admin.id,
                "applied",
                f"{user.full_name} 申请了任务「{task.title}」",
                task.id,
            )
        db.commit()
    return {"ok": True}


@router.get("/tasks/{task_id}/applications", response_model=list[ApplicationOut])
def list_applications(
    task_id: int,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    if not admin_can_touch_task(user, task):
        raise HTTPException(status_code=403, detail="无权查看申请")
    rows = db.scalars(
        select(TaskApplication)
        .where(TaskApplication.task_id == task_id)
        .order_by(TaskApplication.created_at)
    ).all()
    return [ApplicationOut.model_validate(a) for a in rows]
