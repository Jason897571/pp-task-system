from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import User
from app.schemas import LoginIn, MeOut, RegisterIn, TokenOut, UserOut
from app.security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register", response_model=TokenOut)
def register(body: RegisterIn, db: Session = Depends(get_db)):
    user = db.scalars(
        select(User).where(User.invite_code == body.invite_code)
    ).first()
    if user is None or user.account_status != "invited":
        raise HTTPException(status_code=400, detail="邀请码无效或已被使用")

    existing = db.scalars(select(User).where(User.username == body.username)).first()
    if existing is not None:
        raise HTTPException(status_code=400, detail="用户名已存在")

    user.username = body.username
    user.password_hash = hash_password(body.password)
    user.account_status = "active"
    user.invite_code = None
    db.commit()
    db.refresh(user)

    token = create_access_token(user.id)
    return TokenOut(access_token=token, user=UserOut.model_validate(user))


@router.post("/login", response_model=TokenOut)
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = db.scalars(select(User).where(User.username == body.username)).first()
    if (
        user is None
        or user.password_hash is None
        or not verify_password(body.password, user.password_hash)
    ):
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    if not user.is_active or user.account_status != "active":
        raise HTTPException(status_code=401, detail="账号不可用")

    token = create_access_token(user.id)
    return TokenOut(access_token=token, user=UserOut.model_validate(user))


@router.get("/me", response_model=MeOut)
def me(user: User = Depends(get_current_user)):
    return MeOut.model_validate(user)
