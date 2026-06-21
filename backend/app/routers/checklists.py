from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import Checklist, ChecklistItem, Task, User
from app.schemas import (
    ChecklistIn,
    ChecklistItemIn,
    ChecklistItemOut,
    ChecklistItemUpdateIn,
    ChecklistOut,
    ChecklistUpdateIn,
)
from app.services import can_edit_task

router = APIRouter(prefix="/api", tags=["checklists"])


def _require_edit(db: Session, user: User, task: Task) -> None:
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    if not can_edit_task(user, task):
        raise HTTPException(status_code=403, detail="无权编辑该任务清单")


def _next_position(db: Session, model, **filters) -> int:
    stmt = select(func.max(model.position))
    for k, v in filters.items():
        stmt = stmt.where(getattr(model, k) == v)
    max_pos = db.scalar(stmt)
    return (max_pos + 1) if max_pos is not None else 0


@router.post("/tasks/{task_id}/checklists", response_model=ChecklistOut)
def create_checklist(
    task_id: int,
    body: ChecklistIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = db.get(Task, task_id)
    _require_edit(db, user, task)
    cl = Checklist(
        task_id=task_id,
        title=body.title,
        position=_next_position(db, Checklist, task_id=task_id),
    )
    db.add(cl)
    db.commit()
    db.refresh(cl)
    return ChecklistOut.model_validate(cl)


@router.put("/checklists/{cid}", response_model=ChecklistOut)
def update_checklist(
    cid: int,
    body: ChecklistUpdateIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    cl = db.get(Checklist, cid)
    if cl is None:
        raise HTTPException(status_code=404, detail="清单不存在")
    _require_edit(db, user, db.get(Task, cl.task_id))
    if body.title is not None:
        cl.title = body.title
    if body.position is not None:
        cl.position = body.position
    db.commit()
    db.refresh(cl)
    return ChecklistOut.model_validate(cl)


@router.delete("/checklists/{cid}")
def delete_checklist(
    cid: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    cl = db.get(Checklist, cid)
    if cl is None:
        raise HTTPException(status_code=404, detail="清单不存在")
    _require_edit(db, user, db.get(Task, cl.task_id))
    db.delete(cl)
    db.commit()
    return {"ok": True}


@router.post("/checklists/{cid}/items", response_model=ChecklistItemOut)
def create_item(
    cid: int,
    body: ChecklistItemIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    cl = db.get(Checklist, cid)
    if cl is None:
        raise HTTPException(status_code=404, detail="清单不存在")
    _require_edit(db, user, db.get(Task, cl.task_id))
    item = ChecklistItem(
        checklist_id=cid,
        content=body.content,
        position=_next_position(db, ChecklistItem, checklist_id=cid),
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return ChecklistItemOut.model_validate(item)


@router.put("/checklist-items/{iid}", response_model=ChecklistItemOut)
def update_item(
    iid: int,
    body: ChecklistItemUpdateIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = db.get(ChecklistItem, iid)
    if item is None:
        raise HTTPException(status_code=404, detail="清单项不存在")
    cl = db.get(Checklist, item.checklist_id)
    _require_edit(db, user, db.get(Task, cl.task_id))
    if body.is_done is not None:
        item.is_done = body.is_done
    if body.content is not None:
        item.content = body.content
    if body.position is not None:
        item.position = body.position
    db.commit()
    db.refresh(item)
    return ChecklistItemOut.model_validate(item)


@router.delete("/checklist-items/{iid}")
def delete_item(
    iid: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = db.get(ChecklistItem, iid)
    if item is None:
        raise HTTPException(status_code=404, detail="清单项不存在")
    cl = db.get(Checklist, item.checklist_id)
    _require_edit(db, user, db.get(Task, cl.task_id))
    db.delete(item)
    db.commit()
    return {"ok": True}
