import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.database import get_db
from app.deps import get_current_user
from app.models import Attachment, Deliverable, Task, TaskActivity, User
from app.schemas import AttachmentOut
from app.services import admin_can_touch_task, board_can_see, can_edit_task
from sqlalchemy.orm import Session

router = APIRouter(prefix="/api", tags=["files"])

UPLOAD_ROOT = Path("./uploads")
MAX_SIZE = 50 * 1024 * 1024  # 50MB

ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "text/plain",
    "text/csv",
    "text/markdown",
    "text/x-markdown",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/zip",
    "application/x-zip-compressed",
}

# Some file types (notably .md) are reported with an empty or generic
# content_type by the browser/OS, so allow them by extension as a fallback.
ALLOWED_EXTENSIONS = {".md", ".markdown"}


def _task_for_owner(db: Session, owner_type: str, owner_id: int) -> Task | None:
    if owner_type == "task":
        return db.get(Task, owner_id)
    if owner_type == "deliverable":
        d = db.get(Deliverable, owner_id)
        return db.get(Task, d.task_id) if d else None
    if owner_type == "comment":
        a = db.get(TaskActivity, owner_id)
        return db.get(Task, a.task_id) if a else None
    return None


def _related_to_task(db: Session, user: User, task: Task) -> bool:
    """Whoever may see the task may download its files."""
    if user.role == "super_admin":
        return True
    if admin_can_touch_task(user, task):
        return True
    if task.assignee_id == user.id or task.creator_id == user.id:
        return True
    if (
        task.lifecycle == "open"
        and task.department_id == user.department_id
        and board_can_see(db, user, task.board_id)
    ):
        return True
    return False


@router.post("/files/upload", response_model=AttachmentOut)
def upload_file(
    file: UploadFile = File(...),
    owner_type: str = Form(...),
    owner_id: int = Form(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if owner_type not in ("task", "deliverable", "comment"):
        raise HTTPException(status_code=400, detail="无效的 owner_type")

    task = _task_for_owner(db, owner_type, owner_id)
    if task is None:
        raise HTTPException(status_code=404, detail="owner 不存在")
    if not can_edit_task(user, task):
        raise HTTPException(status_code=403, detail="无权上传到该任务")

    ext = Path(file.filename or "").suffix.lower()
    if file.content_type not in ALLOWED_CONTENT_TYPES and ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="不支持的文件类型")

    data = file.file.read()
    if len(data) > MAX_SIZE:
        raise HTTPException(status_code=400, detail="文件超过 50MB 限制")

    year = str(datetime.now(timezone.utc).year)
    dest_dir = UPLOAD_ROOT / year
    dest_dir.mkdir(parents=True, exist_ok=True)
    safe_name = Path(file.filename or "file").name
    stored = dest_dir / f"{uuid.uuid4().hex}-{safe_name}"
    stored.write_bytes(data)

    att = Attachment(
        owner_type=owner_type,
        owner_id=owner_id,
        uploader_id=user.id,
        filename=safe_name,
        filepath=str(stored),
        filesize=len(data),
        content_type=file.content_type,
    )
    db.add(att)
    db.commit()
    db.refresh(att)
    return AttachmentOut.model_validate(att)


@router.get("/files/{file_id}")
def download_file(
    file_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    att = db.get(Attachment, file_id)
    if att is None:
        raise HTTPException(status_code=404, detail="文件不存在")
    task = _task_for_owner(db, att.owner_type, att.owner_id)
    if task is None or not _related_to_task(db, user, task):
        raise HTTPException(status_code=403, detail="无权下载该文件")
    path = Path(att.filepath)
    if not path.exists():
        raise HTTPException(status_code=404, detail="文件已丢失")
    return FileResponse(
        path,
        media_type=att.content_type or "application/octet-stream",
        filename=att.filename,
    )


@router.delete("/files/{file_id}")
def delete_file(
    file_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    att = db.get(Attachment, file_id)
    if att is None:
        raise HTTPException(status_code=404, detail="文件不存在")
    task = _task_for_owner(db, att.owner_type, att.owner_id)
    # the uploader, or anyone who can edit the task, may delete it
    if att.uploader_id != user.id and not (task and can_edit_task(user, task)):
        raise HTTPException(status_code=403, detail="无权删除该文件")
    try:
        Path(att.filepath).unlink(missing_ok=True)
    except OSError:
        pass  # best-effort disk cleanup; still drop the DB row
    db.delete(att)
    db.commit()
    return {"ok": True}
