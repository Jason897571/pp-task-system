from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_admin
from app.models import RecurringTask, RecurringTaskAssignee, User
from app.schemas import RecurringTaskIn, RecurringTaskOut, RecurringTaskUpdateIn
from app.services import generate_recurring_instances

router = APIRouter(prefix="/api", tags=["recurring"])


def _scope_filter(stmt, user: User):
    if user.role != "super_admin":
        stmt = stmt.where(RecurringTask.department_id == user.department_id)
    return stmt


def _validate_assignees(db: Session, user: User, assignee_ids: list[int]) -> list[User]:
    users = []
    for uid in assignee_ids:
        u = db.get(User, uid)
        if u is None:
            raise HTTPException(status_code=404, detail=f"指派人 {uid} 不存在")
        if user.role != "super_admin" and u.department_id != user.department_id:
            raise HTTPException(status_code=403, detail="只能指派本部门成员")
        users.append(u)
    return users


def _set_assignees(db: Session, template: RecurringTask, users: list[User]) -> None:
    db.execute(
        RecurringTaskAssignee.__table__.delete().where(
            RecurringTaskAssignee.recurring_task_id == template.id
        )
    )
    for u in users:
        db.add(RecurringTaskAssignee(recurring_task_id=template.id, user_id=u.id))


def _get_owned(db: Session, user: User, rid: int) -> RecurringTask:
    tpl = db.get(RecurringTask, rid)
    if tpl is None:
        raise HTTPException(status_code=404, detail="模板不存在")
    if user.role != "super_admin" and tpl.department_id != user.department_id:
        raise HTTPException(status_code=403, detail="无权操作该模板")
    return tpl


@router.get("/recurring-tasks", response_model=list[RecurringTaskOut])
def list_recurring(user: User = Depends(require_admin), db: Session = Depends(get_db)):
    stmt = _scope_filter(select(RecurringTask).order_by(RecurringTask.id), user)
    rows = db.scalars(stmt).all()
    return [RecurringTaskOut.model_validate(t) for t in rows]


@router.post("/recurring-tasks", response_model=RecurringTaskOut)
def create_recurring(
    body: RecurringTaskIn,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    users = _validate_assignees(db, user, body.assignee_ids)
    tpl = RecurringTask(
        title=body.title,
        description=body.description,
        creator_id=user.id,
        department_id=user.department_id,
        priority=body.priority or "normal",
        day_of_week=body.day_of_week,
        is_active=True,
    )
    db.add(tpl)
    db.flush()
    _set_assignees(db, tpl, users)
    db.commit()
    db.refresh(tpl)
    return RecurringTaskOut.model_validate(tpl)


@router.put("/recurring-tasks/{rid}", response_model=RecurringTaskOut)
def update_recurring(
    rid: int,
    body: RecurringTaskUpdateIn,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    tpl = _get_owned(db, user, rid)
    if body.title is not None:
        tpl.title = body.title
    if body.description is not None:
        tpl.description = body.description
    if body.priority is not None:
        tpl.priority = body.priority
    if body.day_of_week is not None:
        tpl.day_of_week = body.day_of_week
    if body.is_active is not None:
        tpl.is_active = body.is_active
    if body.assignee_ids is not None:
        users = _validate_assignees(db, user, body.assignee_ids)
        _set_assignees(db, tpl, users)
    db.commit()
    db.refresh(tpl)
    return RecurringTaskOut.model_validate(tpl)


@router.delete("/recurring-tasks/{rid}")
def delete_recurring(
    rid: int,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    tpl = _get_owned(db, user, rid)
    db.execute(
        RecurringTaskAssignee.__table__.delete().where(
            RecurringTaskAssignee.recurring_task_id == rid
        )
    )
    db.delete(tpl)
    db.commit()
    return {"ok": True}


@router.post("/recurring-tasks/{rid}/run-now")
def run_now(
    rid: int,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    tpl = _get_owned(db, user, rid)
    created = generate_recurring_instances(db, date.today(), template=tpl)
    db.commit()
    return {"created": created}
