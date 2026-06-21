from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import Tag, Task, TaskTag, User
from app.schemas import TagIn, TagOut, TaskTagsIn
from app.services import can_edit_task

router = APIRouter(prefix="/api", tags=["tags"])

VALID_COLORS = {"green", "yellow", "orange", "red", "purple", "blue", "sky", "pink", "gray"}


@router.get("/tags", response_model=list[TagOut])
def list_tags(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(Tag).order_by(Tag.id)).all()
    return [TagOut.model_validate(t) for t in rows]


@router.post("/tags", response_model=TagOut)
def create_tag(
    body: TagIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if body.color not in VALID_COLORS:
        raise HTTPException(status_code=400, detail="无效的颜色")
    tag = Tag(name=body.name, color=body.color)
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return TagOut.model_validate(tag)


@router.put("/tasks/{task_id}/tags", response_model=list[TagOut])
def set_task_tags(
    task_id: int,
    body: TaskTagsIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    if not can_edit_task(user, task):
        raise HTTPException(status_code=403, detail="无权编辑该任务标签")

    tags = []
    for tid in body.tag_ids:
        tag = db.get(Tag, tid)
        if tag is None:
            raise HTTPException(status_code=404, detail=f"标签 {tid} 不存在")
        tags.append(tag)

    # full replace
    db.execute(TaskTag.__table__.delete().where(TaskTag.task_id == task_id))
    for tag in tags:
        db.add(TaskTag(task_id=task_id, tag_id=tag.id))
    db.commit()
    return [TagOut.model_validate(t) for t in tags]
