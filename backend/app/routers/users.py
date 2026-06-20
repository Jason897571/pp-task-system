from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require_admin
from app.models import User
from app.schemas import UserOut

router = APIRouter(prefix="/api", tags=["users"])


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
