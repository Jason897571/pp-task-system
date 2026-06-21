from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import Notification, User
from app.schemas import NotificationOut

router = APIRouter(prefix="/api", tags=["notifications"])

LIMIT = 50


@router.get("/notifications", response_model=list[NotificationOut])
def list_notifications(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    rows = db.scalars(
        select(Notification)
        .where(Notification.user_id == user.id)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(LIMIT)
    ).all()
    return [NotificationOut.model_validate(n) for n in rows]


@router.post("/notifications/{nid}/read")
def mark_read(
    nid: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    n = db.get(Notification, nid)
    if n is None or n.user_id != user.id:
        raise HTTPException(status_code=404, detail="通知不存在")
    n.is_read = True
    db.commit()
    return {"ok": True}


@router.post("/notifications/read-all")
def mark_all_read(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    db.execute(
        update(Notification)
        .where(Notification.user_id == user.id, Notification.is_read.is_(False))
        .values(is_read=True)
    )
    db.commit()
    return {"ok": True}
