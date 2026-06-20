"""Idempotent seed script. Run:  uv run python backend/seed.py
(or, from inside backend/ with the venv active:  python -m seed)
"""

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import (
    Board,
    BoardColumn,
    Department,
    Task,
    User,
)
from app.security import hash_password


def get_or_create_department(db: Session, name: str) -> Department:
    dept = db.scalars(select(Department).where(Department.name == name)).first()
    if dept is None:
        dept = Department(name=name)
        db.add(dept)
        db.flush()
    return dept


def get_or_create_user(db: Session, username: str, **kwargs) -> User:
    user = db.scalars(select(User).where(User.username == username)).first()
    if user is None:
        user = User(username=username, **kwargs)
        db.add(user)
        db.flush()
    return user


def get_or_create_board(db: Session, name: str) -> Board:
    board = db.scalars(select(Board).where(Board.name == name)).first()
    if board is None:
        board = Board(name=name, position=0)
        db.add(board)
        db.flush()
    return board


def ensure_column(db: Session, board: Board, name: str, position: int, kind: str) -> BoardColumn:
    col = db.scalars(
        select(BoardColumn).where(
            BoardColumn.board_id == board.id, BoardColumn.name == name
        )
    ).first()
    if col is None:
        col = BoardColumn(board_id=board.id, name=name, position=position, kind=kind)
        db.add(col)
        db.flush()
    return col


def ensure_task(db: Session, title: str, **kwargs) -> Task:
    task = db.scalars(select(Task).where(Task.title == title)).first()
    if task is None:
        task = Task(title=title, **kwargs)
        db.add(task)
        db.flush()
    return task


def main() -> None:
    db = SessionLocal()
    try:
        # super_admin
        super_admin = get_or_create_user(
            db,
            "super",
            full_name="超级管理员",
            password_hash=hash_password("super123"),
            account_status="active",
            role="super_admin",
            department_id=None,
            is_active=True,
        )

        rnd = get_or_create_department(db, "研发部")
        mkt = get_or_create_department(db, "市场部")

        admin = get_or_create_user(
            db,
            "admin",
            full_name="王管理",
            password_hash=hash_password("admin123"),
            account_status="active",
            role="admin",
            department_id=rnd.id,
            is_active=True,
        )
        member = get_or_create_user(
            db,
            "member",
            full_name="李成员",
            password_hash=hash_password("member123"),
            account_status="active",
            role="member",
            department_id=rnd.id,
            is_active=True,
        )
        member2 = get_or_create_user(
            db,
            "member2",
            full_name="赵成员",
            password_hash=hash_password("member123"),
            account_status="active",
            role="member",
            department_id=rnd.id,
            is_active=True,
        )

        board = get_or_create_board(db, "任务看板")
        todo = ensure_column(db, board, "待办", 0, "start")
        doing = ensure_column(db, board, "进行中", 1, "doing")
        review = ensure_column(db, board, "待审核", 2, "review")
        done = ensure_column(db, board, "已完成", 3, "done")

        now = datetime.now(timezone.utc)

        # on-board tasks spread across columns
        ensure_task(
            db,
            "编写接口文档",
            description="完成后端 API 文档",
            creator_id=admin.id,
            assignee_id=member.id,
            department_id=rnd.id,
            board_id=board.id,
            column_id=todo.id,
            lifecycle="on_board",
            priority="high",
            due_date=now + timedelta(days=5),
        )
        ensure_task(
            db,
            "开发登录页",
            description="实现前端登录",
            creator_id=admin.id,
            assignee_id=member.id,
            department_id=rnd.id,
            board_id=board.id,
            column_id=doing.id,
            lifecycle="on_board",
            priority="normal",
        )
        ensure_task(
            db,
            "联调任务池",
            description="等待审核",
            creator_id=admin.id,
            assignee_id=member2.id,
            department_id=rnd.id,
            board_id=board.id,
            column_id=review.id,
            lifecycle="on_board",
            priority="normal",
        )
        ensure_task(
            db,
            "修复样式 bug",
            description="被打回重做",
            creator_id=admin.id,
            assignee_id=member.id,
            department_id=rnd.id,
            board_id=board.id,
            column_id=doing.id,
            lifecycle="on_board",
            is_rework=True,
            priority="normal",
        )
        ensure_task(
            db,
            "上线发布",
            description="已完成",
            creator_id=admin.id,
            assignee_id=member2.id,
            department_id=rnd.id,
            board_id=board.id,
            column_id=done.id,
            lifecycle="on_board",
            priority="low",
        )

        # open pool tasks (研发部)
        ensure_task(
            db,
            "撰写周报",
            description="任务池：待认领",
            creator_id=admin.id,
            assignee_id=None,
            department_id=rnd.id,
            board_id=board.id,
            column_id=None,
            lifecycle="open",
            priority="normal",
        )
        ensure_task(
            db,
            "整理测试用例",
            description="任务池：待认领",
            creator_id=admin.id,
            assignee_id=None,
            department_id=rnd.id,
            board_id=board.id,
            column_id=None,
            lifecycle="open",
            priority="high",
        )
        ensure_task(
            db,
            "调研第三方库",
            description="任务池：待认领",
            creator_id=admin.id,
            assignee_id=None,
            department_id=rnd.id,
            board_id=board.id,
            column_id=None,
            lifecycle="open",
            priority="low",
        )

        db.commit()
        print("Seed complete.")
        print("  super_admin: super / super123")
        print("  admin (研发部): admin / admin123")
        print("  member (研发部): member / member123")
        print("  member2 (研发部): member2 / member123")
    finally:
        db.close()


if __name__ == "__main__":
    main()
