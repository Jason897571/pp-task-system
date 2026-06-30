from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import require_super_admin
from app.feishu import FeishuClient, FeishuError
from app.models import Department, User
from app.schemas import (
    AdminUserIn,
    AdminUserListOut,
    AdminUserOut,
    AdminUserUpdateIn,
    DepartmentIn,
    DepartmentOut,
)
from app.security import generate_invite_code

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_super_admin)])


def _resolve_feishu_open_id(user: User) -> None:
    """Best-effort: fill user.feishu_open_id from phone/email. Silent on any
    failure (e.g. the contact permission isn't granted) — the @ then falls back
    to plain-text name. Use the bulk endpoint to retry after granting access."""
    if not (user.phone or user.email):
        return
    try:
        client = FeishuClient(settings.feishu_app_id, settings.feishu_app_secret)
        oid = client.resolve_open_id(mobile=user.phone or None, email=user.email or None)
        if oid:
            user.feishu_open_id = oid
    except Exception:
        pass


@router.post("/departments", response_model=DepartmentOut)
def create_department(body: DepartmentIn, db: Session = Depends(get_db)):
    if db.scalars(select(Department).where(Department.name == body.name)).first():
        raise HTTPException(status_code=400, detail="部门已存在")
    dept = Department(name=body.name)
    db.add(dept)
    db.commit()
    db.refresh(dept)
    return DepartmentOut.model_validate(dept)


@router.get("/departments", response_model=list[DepartmentOut])
def list_departments(db: Session = Depends(get_db)):
    rows = db.scalars(select(Department).order_by(Department.id)).all()
    return [DepartmentOut.model_validate(d) for d in rows]


@router.post("/users", response_model=AdminUserOut)
def create_user(body: AdminUserIn, db: Session = Depends(get_db)):
    if body.role not in ("super_admin", "admin", "member"):
        raise HTTPException(status_code=400, detail="角色无效")
    if body.role != "super_admin" and body.department_id is None:
        raise HTTPException(status_code=400, detail="非超管用户必须指定部门")
    if body.department_id is not None and not db.get(Department, body.department_id):
        raise HTTPException(status_code=400, detail="部门不存在")

    invite_code = generate_invite_code()
    user = User(
        full_name=body.full_name,
        role=body.role,
        department_id=body.department_id if body.role != "super_admin" else None,
        account_status="invited",
        invite_code=invite_code,
        is_active=True,
        email=(body.email or "").strip() or None,
        phone=(body.phone or "").strip() or None,
    )
    _resolve_feishu_open_id(user)
    db.add(user)
    db.commit()
    db.refresh(user)
    return AdminUserOut.model_validate(user)


@router.get("/users", response_model=list[AdminUserListOut])
def list_users(db: Session = Depends(get_db)):
    rows = db.scalars(select(User).order_by(User.id)).all()
    return [AdminUserListOut.model_validate(u) for u in rows]


@router.put("/users/{user_id}", response_model=AdminUserListOut)
def update_user(user_id: int, body: AdminUserUpdateIn, db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    if body.role is not None:
        if body.role not in ("super_admin", "admin", "member"):
            raise HTTPException(status_code=400, detail="角色无效")
        user.role = body.role
    if body.department_id is not None:
        if not db.get(Department, body.department_id):
            raise HTTPException(status_code=400, detail="部门不存在")
        user.department_id = body.department_id
    if body.is_active is not None:
        user.is_active = body.is_active
    # When email/phone change, refresh the cached Feishu open_id (clear then re-resolve).
    if body.email is not None or body.phone is not None:
        if body.email is not None:
            user.email = body.email.strip() or None
        if body.phone is not None:
            user.phone = body.phone.strip() or None
        user.feishu_open_id = None
        _resolve_feishu_open_id(user)
    db.commit()
    db.refresh(user)
    return AdminUserListOut.model_validate(user)


@router.post("/users/resolve-feishu")
def resolve_feishu_open_ids(db: Session = Depends(get_db)):
    """Bulk-resolve feishu_open_id for every user that has an email/phone. Run
    once after granting the app the contact:user.id:readonly permission."""
    users = db.scalars(
        select(User).where((User.phone.isnot(None)) | (User.email.isnot(None)))
    ).all()
    try:
        client = FeishuClient(settings.feishu_app_id, settings.feishu_app_secret)
    except FeishuError as e:
        raise HTTPException(status_code=502, detail=f"飞书连接失败：{e}") from None

    resolved, failed = 0, 0
    for u in users:
        try:
            oid = client.resolve_open_id(mobile=u.phone or None, email=u.email or None)
        except FeishuError as e:
            # Permission not granted → fail fast with a clear hint.
            raise HTTPException(
                status_code=502,
                detail=f"飞书解析失败（请确认已开通 contact:user.id:readonly 权限并重新发布）：{e}",
            ) from None
        if oid:
            u.feishu_open_id = oid
            resolved += 1
        else:
            failed += 1
    db.commit()
    return {"total": len(users), "resolved": resolved, "failed": failed}
