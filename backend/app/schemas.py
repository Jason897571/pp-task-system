from datetime import datetime

from pydantic import BaseModel, ConfigDict


class UserOut(BaseModel):
    """Nested user shape used everywhere a person is displayed."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    full_name: str
    role: str
    department_id: int | None


class MeOut(UserOut):
    username: str | None
    account_status: str


class DepartmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


class BoardOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    position: int


class BoardColumnOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    board_id: int
    name: str
    position: int
    kind: str | None


class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    description: str | None
    creator: UserOut
    assignee: UserOut | None
    department_id: int | None
    board_id: int
    column_id: int | None
    lifecycle: str
    is_rework: bool
    priority: str
    is_mandatory: bool
    due_date: datetime | None
    created_at: datetime
    updated_at: datetime


class DeliverableOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    submitter: UserOut
    note: str | None
    created_at: datetime


class ApplicationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    applicant: UserOut
    created_at: datetime


class TaskDetailOut(TaskOut):
    deliverables: list[DeliverableOut]
    applications: list[ApplicationOut]


# ---- request bodies ----


class RegisterIn(BaseModel):
    invite_code: str
    username: str
    password: str


class LoginIn(BaseModel):
    username: str
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class DepartmentIn(BaseModel):
    name: str


class AdminUserIn(BaseModel):
    full_name: str
    department_id: int | None = None
    role: str  # admin | member (super_admin allowed too)


class AdminUserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    full_name: str
    role: str
    department_id: int | None
    account_status: str
    invite_code: str | None = None


class AdminUserListOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    full_name: str
    role: str
    department_id: int | None
    account_status: str
    username: str | None


class AdminUserUpdateIn(BaseModel):
    role: str | None = None
    department_id: int | None = None
    is_active: bool | None = None


class ColumnIn(BaseModel):
    name: str
    kind: str | None = None


class ColumnUpdateIn(BaseModel):
    name: str | None = None
    kind: str | None = None
    position: int | None = None


class TaskIn(BaseModel):
    title: str
    description: str | None = None
    board_id: int
    priority: str | None = "normal"
    assignee_id: int | None = None
    department_id: int | None = None
    due_date: datetime | None = None


class AssignIn(BaseModel):
    assignee_id: int


class ApproveIn(BaseModel):
    approve: bool
    assignee_id: int | None = None


class MoveIn(BaseModel):
    column_id: int


class SubmitIn(BaseModel):
    note: str | None = None


class ReviewIn(BaseModel):
    approve: bool
    comment: str | None = None
