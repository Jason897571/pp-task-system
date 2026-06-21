from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, require_super_admin
from app.models import (
    Attachment,
    Board,
    BoardColumn,
    BoardMemberVisibility,
    BoardVisibility,
    Checklist,
    ChecklistItem,
    Deliverable,
    Notification,
    Task,
    TaskActivity,
    TaskApplication,
    TaskTag,
    User,
)
from app.schemas import (
    BoardColumnOut,
    BoardIn,
    BoardMemberVisibilityIn,
    BoardOut,
    BoardReorderIn,
    ColumnIn,
    ColumnUpdateIn,
)
from app.services import (
    archive_completed_tasks,
    board_can_see,
    first_column,
    get_or_create_archive_board,
    visible_board_ids,
)

router = APIRouter(prefix="/api", tags=["boards"])

# Default workflow columns a new board starts with (name, kind).
DEFAULT_COLUMNS = [
    ("待办", "start"),
    ("进行中", "doing"),
    ("待审核", "review"),
    ("已完成", "done"),
]


@router.get("/boards", response_model=list[BoardOut])
def list_boards(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Ensure the global archive board exists so it always shows in the sidebar.
    get_or_create_archive_board(db)
    db.commit()
    ids = visible_board_ids(db, user)
    # Archive board is always pinned last, regardless of its stored position.
    stmt = select(Board).order_by(Board.is_archive, Board.position, Board.id)
    if ids is not None:
        stmt = stmt.where(Board.id.in_(ids))
    rows = db.scalars(stmt).all()
    return [BoardOut.model_validate(b) for b in rows]


@router.post("/boards", response_model=BoardOut)
def create_board(
    body: BoardIn,
    user: User = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="看板名称不能为空")
    next_pos = db.scalar(select(func.coalesce(func.max(Board.position), -1))) + 1
    board = Board(name=name, position=next_pos)
    db.add(board)
    db.flush()
    for pos, (col_name, kind) in enumerate(DEFAULT_COLUMNS):
        db.add(BoardColumn(board_id=board.id, name=col_name, position=pos, kind=kind))
    db.commit()
    db.refresh(board)
    return BoardOut.model_validate(board)


@router.put("/boards/reorder")
def reorder_boards(
    body: BoardReorderIn,
    user: User = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """Set each board's position to its index in board_ids (drag-reorder)."""
    for pos, bid in enumerate(body.board_ids):
        board = db.get(Board, bid)
        if board is not None:
            board.position = pos
    db.commit()
    return {"ok": True}


@router.get("/boards/visibility-matrix")
def visibility_matrix(
    user: User = Depends(require_super_admin), db: Session = Depends(get_db)
):
    """Board × user visibility for the 管理 matrix. `visibility[board_id]` is the
    explicit allow-list of user ids; a board absent from it = visible to all."""
    boards = db.scalars(select(Board).order_by(Board.position, Board.id)).all()
    users = db.scalars(
        select(User)
        .where(
            User.role.in_(("admin", "member")),
            User.is_active.is_(True),
            User.account_status == "active",
        )
        .order_by(User.full_name)
    ).all()
    vis: dict[int, list[int]] = {}
    for bid, uid in db.execute(
        select(BoardMemberVisibility.board_id, BoardMemberVisibility.user_id)
    ).all():
        vis.setdefault(bid, []).append(uid)
    return {
        "boards": [{"id": b.id, "name": b.name} for b in boards],
        "users": [
            {
                "id": u.id,
                "full_name": u.full_name,
                "role": u.role,
                "department_id": u.department_id,
            }
            for u in users
        ],
        "visibility": vis,
    }


@router.put("/boards/{board_id}/member-visibility")
def set_member_visibility(
    board_id: int,
    body: BoardMemberVisibilityIn,
    user: User = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """Replace a board's per-user allow-list. Empty list = visible to everyone."""
    if db.get(Board, board_id) is None:
        raise HTTPException(status_code=404, detail="看板不存在")
    db.execute(
        delete(BoardMemberVisibility).where(BoardMemberVisibility.board_id == board_id)
    )
    for uid in dict.fromkeys(body.user_ids):  # de-dupe, keep order
        if db.get(User, uid) is not None:
            db.add(BoardMemberVisibility(board_id=board_id, user_id=uid))
    db.commit()
    return {"ok": True}


@router.delete("/boards/{board_id}")
def delete_board(
    board_id: int,
    user: User = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    board = db.get(Board, board_id)
    if board is None:
        raise HTTPException(status_code=404, detail="看板不存在")

    task_ids = list(db.scalars(select(Task.id).where(Task.board_id == board_id)).all())
    if task_ids:
        deliverable_ids = list(
            db.scalars(select(Deliverable.id).where(Deliverable.task_id.in_(task_ids))).all()
        )
        checklist_ids = list(
            db.scalars(select(Checklist.id).where(Checklist.task_id.in_(task_ids))).all()
        )
        # delete card-dependent rows in FK-safe order (no DB-level cascade configured)
        if checklist_ids:
            db.execute(delete(ChecklistItem).where(ChecklistItem.checklist_id.in_(checklist_ids)))
        db.execute(delete(Checklist).where(Checklist.task_id.in_(task_ids)))
        attach_cond = (Attachment.owner_type == "task") & (Attachment.owner_id.in_(task_ids))
        if deliverable_ids:
            attach_cond = attach_cond | (
                (Attachment.owner_type == "deliverable")
                & (Attachment.owner_id.in_(deliverable_ids))
            )
        db.execute(delete(Attachment).where(attach_cond))
        db.execute(delete(Deliverable).where(Deliverable.task_id.in_(task_ids)))
        db.execute(delete(TaskApplication).where(TaskApplication.task_id.in_(task_ids)))
        db.execute(delete(TaskTag).where(TaskTag.task_id.in_(task_ids)))
        db.execute(delete(TaskActivity).where(TaskActivity.task_id.in_(task_ids)))
        db.execute(delete(Notification).where(Notification.related_task_id.in_(task_ids)))
        db.execute(delete(Task).where(Task.board_id == board_id))

    db.execute(delete(BoardVisibility).where(BoardVisibility.board_id == board_id))
    db.execute(
        delete(BoardMemberVisibility).where(BoardMemberVisibility.board_id == board_id)
    )
    db.execute(delete(BoardColumn).where(BoardColumn.board_id == board_id))
    db.delete(board)
    db.commit()
    return {"ok": True}


@router.get("/boards/{board_id}/columns", response_model=list[BoardColumnOut])
def list_columns(
    board_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if db.get(Board, board_id) is None:
        raise HTTPException(status_code=404, detail="看板不存在")
    if not board_can_see(db, user, board_id):
        raise HTTPException(status_code=403, detail="无权查看该看板")
    rows = db.scalars(
        select(BoardColumn)
        .where(BoardColumn.board_id == board_id)
        .order_by(BoardColumn.position)
    ).all()
    return [BoardColumnOut.model_validate(c) for c in rows]


@router.post("/boards/{board_id}/columns", response_model=BoardColumnOut)
def create_column(
    board_id: int,
    body: ColumnIn,
    user: User = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    if db.get(Board, board_id) is None:
        raise HTTPException(status_code=404, detail="看板不存在")
    max_pos = db.scalar(
        select(func.max(BoardColumn.position)).where(BoardColumn.board_id == board_id)
    )
    col = BoardColumn(
        board_id=board_id,
        name=body.name,
        kind=body.kind,
        position=(max_pos + 1) if max_pos is not None else 0,
    )
    db.add(col)
    db.commit()
    db.refresh(col)
    return BoardColumnOut.model_validate(col)


@router.put("/columns/{cid}", response_model=BoardColumnOut)
def update_column(
    cid: int,
    body: ColumnUpdateIn,
    user: User = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    col = db.get(BoardColumn, cid)
    if col is None:
        raise HTTPException(status_code=404, detail="列不存在")
    if body.name is not None:
        col.name = body.name
    if body.kind is not None:
        col.kind = body.kind
    if body.position is not None:
        col.position = body.position
    if body.is_final is not None:
        if body.is_final:
            # At most one final column per board — clear the flag on siblings.
            for sibling in db.scalars(
                select(BoardColumn).where(BoardColumn.board_id == col.board_id)
            ).all():
                sibling.is_final = False
        col.is_final = body.is_final
    db.commit()
    db.refresh(col)
    return BoardColumnOut.model_validate(col)


@router.delete("/columns/{cid}")
def delete_column(
    cid: int,
    user: User = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    col = db.get(BoardColumn, cid)
    if col is None:
        raise HTTPException(status_code=404, detail="列不存在")

    target = db.scalars(
        select(BoardColumn)
        .where(BoardColumn.board_id == col.board_id, BoardColumn.id != cid)
        .order_by(BoardColumn.position)
        .limit(1)
    ).first()
    if target is None:
        raise HTTPException(status_code=409, detail="看板至少需要保留一列")

    # migrate cards to the board's first remaining column
    for task in db.scalars(select(Task).where(Task.column_id == cid)).all():
        task.column_id = target.id

    db.delete(col)
    db.commit()
    return {"ok": True}


@router.post("/boards/archive-now")
def archive_now(
    user: User = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """Run the weekly archive sweep immediately (super_admin)."""
    count = archive_completed_tasks(db)
    db.commit()
    return {"archived": count}
