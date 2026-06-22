"""Helpers to construct a standard test world directly via the DB session."""

from app.models import Board, BoardColumn, Department, User
from app.security import hash_password


def make_user(db, username, role, department_id, full_name=None, active=True):
    u = User(
        full_name=full_name or username,
        username=username,
        password_hash=hash_password("pw"),
        account_status="active",
        role=role,
        department_id=department_id,
        is_active=active,
    )
    db.add(u)
    db.flush()
    return u


def make_board_with_columns(db, name="任务看板"):
    board = Board(name=name, position=0)
    db.add(board)
    db.flush()
    cols = {}
    for i, (cname, kind) in enumerate(
        [("待办", "start"), ("进行中", "doing"), ("待审核", "review"), ("已完成", "done")]
    ):
        c = BoardColumn(
            board_id=board.id, name=cname, position=i, kind=kind,
            requires_review=(kind == "review"),
        )
        db.add(c)
        db.flush()
        cols[kind] = c
    return board, cols


def standard_world(db):
    """Returns dict with departments, users, board, columns."""
    rnd = Department(name="研发部")
    mkt = Department(name="市场部")
    db.add_all([rnd, mkt])
    db.flush()

    world = {
        "rnd": rnd,
        "mkt": mkt,
        "super": make_user(db, "super", "super_admin", None, "超管"),
        "admin": make_user(db, "admin", "admin", rnd.id, "研发管理"),
        "member": make_user(db, "member", "member", rnd.id, "研发成员"),
        "member2": make_user(db, "member2", "member", rnd.id, "研发成员2"),
        "mkt_admin": make_user(db, "mkt_admin", "admin", mkt.id, "市场管理"),
        "mkt_member": make_user(db, "mkt_member", "member", mkt.id, "市场成员"),
    }
    board, cols = make_board_with_columns(db)
    world["board"] = board
    world["cols"] = cols
    db.commit()
    return world
