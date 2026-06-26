import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, require_admin
from app.models import Attachment, User
from app.schemas import MeOut, MeSettingsIn, UserOut

router = APIRouter(prefix="/api", tags=["users"])

UPLOAD_ROOT = Path("./uploads")
AVATAR_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
AVATAR_MAX = 5 * 1024 * 1024  # 5MB


@router.put("/me/settings", response_model=MeOut)
def update_my_settings(
    body: MeSettingsIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update the current user's personal settings (card colour)."""
    user.card_color = (body.card_color or "").strip() or None
    db.commit()
    db.refresh(user)
    return MeOut.model_validate(user)


@router.post("/me/avatar", response_model=MeOut)
def upload_my_avatar(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Upload a custom avatar image; replaces any previous one."""
    if file.content_type not in AVATAR_TYPES:
        raise HTTPException(status_code=400, detail="头像仅支持图片（png/jpg/webp/gif）")
    data = file.file.read()
    if len(data) > AVATAR_MAX:
        raise HTTPException(status_code=400, detail="头像不能超过 5MB")

    # Drop the previous avatar (file + row) so we don't accumulate orphans.
    if user.avatar_attachment_id is not None:
        old = db.get(Attachment, user.avatar_attachment_id)
        if old is not None:
            try:
                Path(old.filepath).unlink(missing_ok=True)
            except OSError:
                pass
            db.delete(old)

    dest_dir = UPLOAD_ROOT / "avatars"
    dest_dir.mkdir(parents=True, exist_ok=True)
    safe_name = Path(file.filename or "avatar").name
    stored = dest_dir / f"{uuid.uuid4().hex}-{safe_name}"
    stored.write_bytes(data)

    att = Attachment(
        owner_type="avatar",
        owner_id=user.id,
        uploader_id=user.id,
        filename=safe_name,
        filepath=str(stored),
        filesize=len(data),
        content_type=file.content_type,
    )
    db.add(att)
    db.flush()
    user.avatar_attachment_id = att.id
    db.commit()
    db.refresh(user)
    return MeOut.model_validate(user)


@router.get("/users", response_model=list[UserOut])
def list_assignable_users(
    user: User = Depends(require_admin), db: Session = Depends(get_db)
):
    """Assignable candidates for assign/transfer/approve dropdowns.

    admin -> active admins/members in own department; super_admin -> all active
    admins/members. (Cross-department assign is possible via /assign but the
    convenience list stays department-scoped for admins.)
    """
    stmt = select(User).where(
        User.is_active.is_(True),
        User.account_status == "active",
        User.role.in_(("admin", "member")),
    )
    if user.role != "super_admin":
        stmt = stmt.where(User.department_id == user.department_id)
    rows = db.scalars(stmt.order_by(User.full_name)).all()
    return [UserOut.model_validate(u) for u in rows]
