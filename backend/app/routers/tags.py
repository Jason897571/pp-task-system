from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, require_super_admin
from app.models import Tag, Task, TaskTag, User
from app.schemas import TagIn, TagOut, TagUpdateIn, TaskTagsIn
from app.services import can_edit_task

router = APIRouter(prefix="/api", tags=["tags"])

VALID_COLORS = {"green", "yellow", "orange", "red", "purple", "blue", "sky", "pink", "gray"}


def _clean_link(link: str | None) -> str | None:
    """Normalize an optional tag link. Only http(s) URLs are allowed (a card
    opens it via window.open, so javascript:/data: must be rejected)."""
    if link is None:
        return None
    link = link.strip()
    if not link:
        return None
    if not (link.startswith("http://") or link.startswith("https://")):
        raise HTTPException(status_code=400, detail="链接必须以 http:// 或 https:// 开头")
    return link


@router.get("/tags", response_model=list[TagOut])
def list_tags(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(Tag).order_by(Tag.id)).all()
    return [TagOut.model_validate(t) for t in rows]


@router.post("/tags", response_model=TagOut)
def create_tag(
    body: TagIn,
    user: User = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    if body.color not in VALID_COLORS:
        raise HTTPException(status_code=400, detail="无效的颜色")
    tag = Tag(name=body.name, color=body.color, link=_clean_link(body.link))
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return TagOut.model_validate(tag)


@router.put("/tags/{tag_id}", response_model=TagOut)
def update_tag(
    tag_id: int,
    body: TagUpdateIn,
    user: User = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    tag = db.get(Tag, tag_id)
    if tag is None:
        raise HTTPException(status_code=404, detail="标签不存在")
    if body.color is not None:
        if body.color not in VALID_COLORS:
            raise HTTPException(status_code=400, detail="无效的颜色")
        tag.color = body.color
    if body.name is not None:
        tag.name = body.name
    if body.link is not None:
        tag.link = _clean_link(body.link)
    db.commit()
    db.refresh(tag)
    return TagOut.model_validate(tag)


@router.delete("/tags/{tag_id}")
def delete_tag(
    tag_id: int,
    user: User = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    tag = db.get(Tag, tag_id)
    if tag is None:
        raise HTTPException(status_code=404, detail="标签不存在")
    db.execute(TaskTag.__table__.delete().where(TaskTag.tag_id == tag_id))
    db.delete(tag)
    db.commit()
    return {"ok": True}


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
