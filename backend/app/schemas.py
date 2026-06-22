from datetime import datetime, timezone

from pydantic import BaseModel, ConfigDict, field_serializer


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
    icon: str | None = None
    is_archive: bool = False


class BoardColumnOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    board_id: int
    name: str
    position: int
    kind: str | None
    is_final: bool = False
    requires_review: bool = False


class TagOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    color: str


class ChecklistStats(BaseModel):
    done: int
    total: int


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
    deleted_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    tags: list[TagOut] = []
    checklist_stats: ChecklistStats = ChecklistStats(done=0, total=0)

    @field_serializer("due_date", "deleted_at")
    def _serialize_utc(self, v: datetime | None) -> str | None:
        # due_date / deleted_at are stored naive-UTC. Mark them UTC on the way out
        # so the browser converts to local time instead of reading the bare string
        # as local. (created_at/updated_at use DB-local func.now(); left untouched.)
        if v is None:
            return None
        if v.tzinfo is None:
            v = v.replace(tzinfo=timezone.utc)
        return v.isoformat()


class AttachmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    owner_type: str
    owner_id: int
    filename: str
    filesize: int
    content_type: str | None
    uploader: UserOut
    created_at: datetime


class DeliverableOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    submitter: UserOut
    note: str | None
    created_at: datetime
    attachments: list[AttachmentOut] = []


class ApplicationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    applicant: UserOut
    created_at: datetime


class ChecklistItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    content: str
    is_done: bool
    position: int


class ChecklistOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    position: int
    items: list[ChecklistItemOut] = []


class TaskDetailOut(TaskOut):
    deliverables: list[DeliverableOut]
    applications: list[ApplicationOut]
    checklists: list[ChecklistOut] = []
    attachments: list[AttachmentOut] = []


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
    invite_code: str | None = None


class AdminUserUpdateIn(BaseModel):
    role: str | None = None
    department_id: int | None = None
    is_active: bool | None = None


class BoardIn(BaseModel):
    name: str


class BoardUpdateIn(BaseModel):
    name: str | None = None
    icon: str | None = None


class BoardReorderIn(BaseModel):
    board_ids: list[int]


class BoardMemberVisibilityIn(BaseModel):
    # explicit allow-list of user ids; empty => visible to everyone
    user_ids: list[int]


class ColumnIn(BaseModel):
    name: str
    kind: str | None = None


class ColumnUpdateIn(BaseModel):
    name: str | None = None
    kind: str | None = None
    position: int | None = None
    is_final: bool | None = None
    requires_review: bool | None = None


class TaskIn(BaseModel):
    title: str
    description: str | None = None
    board_id: int
    priority: str | None = "normal"
    assignee_id: int | None = None
    department_id: int | None = None
    due_date: datetime | None = None


class TaskUpdateIn(BaseModel):
    title: str | None = None
    description: str | None = None
    priority: str | None = None
    due_date: datetime | None = None


class AssignIn(BaseModel):
    assignee_id: int


class ApproveIn(BaseModel):
    approve: bool
    assignee_id: int | None = None


class MoveIn(BaseModel):
    column_id: int


class MoveBoardIn(BaseModel):
    """Cross-board move used to restore an archived card to another board."""

    board_id: int
    column_id: int


class SubmitIn(BaseModel):
    note: str | None = None


class ReviewIn(BaseModel):
    approve: bool
    comment: str | None = None


# ---- round-2 request bodies / outputs ----


class TagIn(BaseModel):
    name: str
    color: str


class TaskTagsIn(BaseModel):
    tag_ids: list[int]


class ChecklistIn(BaseModel):
    title: str


class ChecklistUpdateIn(BaseModel):
    title: str | None = None
    position: int | None = None


class ChecklistItemIn(BaseModel):
    content: str


class ChecklistItemUpdateIn(BaseModel):
    is_done: bool | None = None
    content: str | None = None
    position: int | None = None


class RecurringTaskIn(BaseModel):
    title: str
    description: str | None = None
    priority: str | None = "normal"
    day_of_week: int = 0
    assignee_ids: list[int] = []


class RecurringTaskUpdateIn(BaseModel):
    title: str | None = None
    description: str | None = None
    priority: str | None = None
    day_of_week: int | None = None
    is_active: bool | None = None
    assignee_ids: list[int] | None = None


class RecurringTaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    description: str | None
    priority: str
    day_of_week: int
    is_active: bool
    assignees: list[UserOut] = []


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    type: str
    message: str
    related_task_id: int | None
    is_read: bool
    created_at: datetime
