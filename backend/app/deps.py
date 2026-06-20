from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User
from app.security import decode_token


def get_current_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="未认证")
    token = authorization.split(" ", 1)[1].strip()
    user_id = decode_token(token)
    if user_id is None:
        raise HTTPException(status_code=401, detail="token 失效")
    user = db.get(User, user_id)
    if user is None or not user.is_active or user.account_status != "active":
        raise HTTPException(status_code=401, detail="账号不可用")
    return user


def require_super_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "super_admin":
        raise HTTPException(status_code=403, detail="需要超级管理员权限")
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    """admin or super_admin."""
    if user.role not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="需要管理员权限")
    return user
