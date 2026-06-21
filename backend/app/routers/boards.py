from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, require_super_admin
from app.models import Board, BoardColumn, Task, User
from app.schemas import BoardColumnOut, BoardIn, BoardOut, ColumnIn, ColumnUpdateIn
from app.services import board_can_see, first_column, visible_board_ids

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
    ids = visible_board_ids(db, user)
    stmt = select(Board).order_by(Board.position, Board.id)
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
