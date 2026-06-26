"""Full data model per design spec §4.

Round-2 features (RecurringTask, Tag, Checklist, Attachment, Notification, ...)
are now wired to endpoints; see the round-2 routers.
"""

from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Department(Base):
    __tablename__ = "departments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    full_name: Mapped[str] = mapped_column(String(100))
    username: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    invite_code: Mapped[str | None] = mapped_column(String(32), unique=True, nullable=True)
    account_status: Mapped[str] = mapped_column(String(20), default="invited")  # invited | active
    department_id: Mapped[int | None] = mapped_column(
        ForeignKey("departments.id"), nullable=True
    )
    role: Mapped[str] = mapped_column(String(20))  # super_admin | admin | member
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Personal settings: a custom avatar (Attachment id, plain int — no FK so the
    # attachment can be swapped/removed freely) and a card background colour
    # (#rrggbb / #rrggbbaa) applied to cards this user is assigned to.
    avatar_attachment_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    card_color: Mapped[str | None] = mapped_column(String(9), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    department: Mapped[Department | None] = relationship()


class Board(Base):
    __tablename__ = "boards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    position: Mapped[int] = mapped_column(Integer, default=0)
    # Emoji shown before the board name in the sidebar; super_admin picks it.
    # NULL falls back to 📋 on the frontend.
    icon: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # The single global archive board that completed cards are swept into weekly.
    is_archive: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    columns: Mapped[list["BoardColumn"]] = relationship(
        back_populates="board", order_by="BoardColumn.position"
    )


class BoardColumn(Base):
    __tablename__ = "board_columns"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    board_id: Mapped[int] = mapped_column(ForeignKey("boards.id"))
    name: Mapped[str] = mapped_column(String(100))
    position: Mapped[int] = mapped_column(Integer, default=0)
    kind: Mapped[str | None] = mapped_column(String(20), nullable=True)  # start|doing|review|done|null
    # super_admin marks one column per board as the final acceptance stage. Cards
    # here count as completed and are auto-archived every Saturday.
    is_final: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    # super_admin marks at most one column per board as the review gate. A member's
    # 提交 lands the card here to await admin approval; if no column requires review
    # the card goes straight to the done column.
    requires_review: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    # Only set on archive-board columns: the origin board these archived cards came
    # from. Plain int (no FK) so the origin board can be deleted independently; the
    # column's display name is kept in sync with that board's current name.
    source_board_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    board: Mapped[Board] = relationship(back_populates="columns")


class BoardVisibility(Base):
    __tablename__ = "board_visibility"

    board_id: Mapped[int] = mapped_column(ForeignKey("boards.id"), primary_key=True)
    department_id: Mapped[int] = mapped_column(
        ForeignKey("departments.id"), primary_key=True
    )


class BoardMemberVisibility(Base):
    """Per-user board visibility. A board with no rows = visible to everyone;
    once it has rows, only the listed users (and super_admin) may see it."""

    __tablename__ = "board_member_visibility"

    board_id: Mapped[int] = mapped_column(ForeignKey("boards.id"), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    creator_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    assignee_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    department_id: Mapped[int | None] = mapped_column(
        ForeignKey("departments.id"), nullable=True
    )
    board_id: Mapped[int] = mapped_column(ForeignKey("boards.id"))
    column_id: Mapped[int | None] = mapped_column(
        ForeignKey("board_columns.id"), nullable=True
    )
    lifecycle: Mapped[str] = mapped_column(String(20), default="on_board")
    # open | pending_approval | on_board | declined
    is_rework: Mapped[bool] = mapped_column(Boolean, default=False)
    priority: Mapped[str] = mapped_column(String(10), default="normal")  # low|normal|high
    is_mandatory: Mapped[bool] = mapped_column(Boolean, default=False)
    recurring_task_id: Mapped[int | None] = mapped_column(
        ForeignKey("recurring_tasks.id"), nullable=True
    )
    due_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Soft delete: non-null = in the recycle bin (purged 30 days after this time).
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    creator: Mapped[User] = relationship(foreign_keys=[creator_id])
    assignee: Mapped[User | None] = relationship(foreign_keys=[assignee_id])
    column: Mapped[BoardColumn | None] = relationship()
    deliverables: Mapped[list["Deliverable"]] = relationship(
        back_populates="task", order_by="Deliverable.created_at"
    )
    applications: Mapped[list["TaskApplication"]] = relationship(
        back_populates="task", order_by="TaskApplication.created_at"
    )
    tags: Mapped[list["Tag"]] = relationship(
        secondary="task_tags", order_by="Tag.id"
    )
    checklists: Mapped[list["Checklist"]] = relationship(
        back_populates="task", order_by="Checklist.position",
        cascade="all, delete-orphan",
    )


class TaskApplication(Base):
    __tablename__ = "task_applications"
    __table_args__ = (UniqueConstraint("task_id", "applicant_id", name="uq_task_applicant"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id"))
    applicant_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    task: Mapped[Task] = relationship(back_populates="applications")
    applicant: Mapped[User] = relationship()


class Deliverable(Base):
    __tablename__ = "deliverables"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id"))
    submitter_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    task: Mapped[Task] = relationship(back_populates="deliverables")
    submitter: Mapped[User] = relationship()


class TaskActivity(Base):
    __tablename__ = "task_activities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id"))
    actor_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(20))
    # assigned|reassigned|submitted|approved|rejected|commented
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class TaskLink(Base):
    """Symmetric "related task" link between two tasks. The pair is normalized so
    task_a_id < task_b_id — one row per relationship, queried from either side."""

    __tablename__ = "task_links"
    __table_args__ = (UniqueConstraint("task_a_id", "task_b_id", name="uq_task_link_pair"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    task_a_id: Mapped[int] = mapped_column(ForeignKey("tasks.id"), index=True)
    task_b_id: Mapped[int] = mapped_column(ForeignKey("tasks.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


# ---------------------------------------------------------------------------
# DEFERRED models (schema completeness per spec §4). No endpoints in MVP.
# ---------------------------------------------------------------------------


class RecurringTask(Base):
    __tablename__ = "recurring_tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    creator_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    department_id: Mapped[int | None] = mapped_column(
        ForeignKey("departments.id"), nullable=True
    )
    priority: Mapped[str] = mapped_column(String(10), default="normal")
    day_of_week: Mapped[int] = mapped_column(Integer, default=0)  # 0 = Monday
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    assignees: Mapped[list["User"]] = relationship(
        secondary="recurring_task_assignees", order_by="User.id"
    )


class RecurringTaskAssignee(Base):
    __tablename__ = "recurring_task_assignees"

    recurring_task_id: Mapped[int] = mapped_column(
        ForeignKey("recurring_tasks.id"), primary_key=True
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)


class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(50))
    color: Mapped[str] = mapped_column(String(20))


class TaskTag(Base):
    __tablename__ = "task_tags"

    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id"), primary_key=True)
    tag_id: Mapped[int] = mapped_column(ForeignKey("tags.id"), primary_key=True)


class Checklist(Base):
    __tablename__ = "checklists"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id"))
    title: Mapped[str] = mapped_column(String(255))
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    task: Mapped[Task] = relationship(back_populates="checklists")
    items: Mapped[list["ChecklistItem"]] = relationship(
        back_populates="checklist", order_by="ChecklistItem.position",
        cascade="all, delete-orphan",
    )


class ChecklistItem(Base):
    __tablename__ = "checklist_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    checklist_id: Mapped[int] = mapped_column(ForeignKey("checklists.id"))
    content: Mapped[str] = mapped_column(String(500))
    is_done: Mapped[bool] = mapped_column(Boolean, default=False)
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    checklist: Mapped[Checklist] = relationship(back_populates="items")


class Attachment(Base):
    __tablename__ = "attachments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_type: Mapped[str] = mapped_column(String(20))  # task | deliverable
    owner_id: Mapped[int] = mapped_column(Integer)
    uploader_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    filename: Mapped[str] = mapped_column(String(255))
    filepath: Mapped[str] = mapped_column(String(500))
    filesize: Mapped[int] = mapped_column(Integer)
    content_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    uploader: Mapped[User] = relationship()


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    type: Mapped[str] = mapped_column(String(50))
    message: Mapped[str] = mapped_column(String(500))
    related_task_id: Mapped[int | None] = mapped_column(
        ForeignKey("tasks.id"), nullable=True
    )
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
