"""Sync every site task into the Feishu (Lark) bitable on demand (super_admin).

Idempotent upsert keyed by 任务ID: re-running updates rows in place and adds new
ones. Rows for tasks no longer present (e.g. deleted) are left untouched.
created_at/updated_at are stored Shanghai-local; due_date is naive UTC — both are
converted to epoch-ms for Feishu DateTime fields.
"""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import require_super_admin
from app.feishu import FT_DATETIME, FT_TEXT, FeishuClient, FeishuError
from app.models import Board, BoardColumn, Department, Task, User

router = APIRouter(prefix="/api", tags=["feishu"])

SH = ZoneInfo("Asia/Shanghai")

KEY_FIELD = "任务ID"
# (name, feishu field type). The first entry is the table's primary field.
FIELD_SPECS: list[tuple[str, int]] = [
    (KEY_FIELD, FT_TEXT),
    ("标题", FT_TEXT),
    ("状态", FT_TEXT),
    ("看板", FT_TEXT),
    ("阶段", FT_TEXT),
    ("负责人", FT_TEXT),
    ("创建人", FT_TEXT),
    ("部门", FT_TEXT),
    ("优先级", FT_TEXT),
    ("截止时间", FT_DATETIME),
    ("创建时间", FT_DATETIME),
    ("更新时间", FT_DATETIME),
    ("描述", FT_TEXT),
]

PRIORITY_LABEL = {"high": "高", "normal": "普通", "low": "低"}


def _ms_sh(dt: datetime | None) -> int | None:
    return int(dt.replace(tzinfo=SH).timestamp() * 1000) if dt else None


def _ms_utc(dt: datetime | None) -> int | None:
    return int(dt.replace(tzinfo=timezone.utc).timestamp() * 1000) if dt else None


def _ensure_fields(fs: FeishuClient, app_token: str, table_id: str) -> None:
    """Create any missing fields; repurpose the table's primary field as 任务ID."""
    existing = fs.list_fields(app_token, table_id)
    by_name = {f["field_name"]: f for f in existing}

    if KEY_FIELD not in by_name:
        primary = next((f for f in existing if f.get("is_primary")), None)
        if primary is not None:
            fs.rename_field(app_token, table_id, primary["field_id"], KEY_FIELD, FT_TEXT)
            by_name[KEY_FIELD] = primary

    for name, ftype in FIELD_SPECS:
        if name in by_name:
            continue
        prop = {"date_formatter": "yyyy-MM-dd HH:mm"} if ftype == FT_DATETIME else None
        fs.create_field(app_token, table_id, name, ftype, prop)


def _row_for(t: Task, boards: dict, cols: dict, depts: dict) -> dict:
    col = cols.get(t.column_id) if t.column_id else None
    # Archived cards: the column carries the origin board id — surface the real
    # project instead of "归档看板", and mark the stage as 已归档.
    if col is not None and col.source_board_id is not None:
        origin = boards.get(col.source_board_id)
        board_name, stage = (origin.name if origin else ""), "已归档"
    else:
        board = boards.get(t.board_id)
        board_name, stage = (board.name if board else ""), (col.name if col else "")

    if t.board_id in boards and boards[t.board_id].is_archive:
        status = "已完成"
    elif t.lifecycle == "open":
        status = "待认领（任务池）"
    elif t.lifecycle == "pending_approval":
        status = "待审批"
    elif t.lifecycle == "declined":
        status = "已拒绝"
    elif col is not None and (col.kind == "done" or col.is_final):
        status = "已完成"
    else:
        status = stage or "进行中"

    fields = {
        KEY_FIELD: str(t.id),
        "标题": t.title or "",
        "状态": status,
        "看板": board_name or "",
        "阶段": stage or "",
        "负责人": t.assignee.full_name if t.assignee else "",
        "创建人": t.creator.full_name if t.creator else "",
        "部门": depts.get(t.department_id, "") if t.department_id else "",
        "优先级": PRIORITY_LABEL.get(t.priority, t.priority or ""),
        "创建时间": _ms_sh(t.created_at),
        "更新时间": _ms_sh(t.updated_at),
        "描述": t.description or "",
    }
    due = _ms_utc(t.due_date)
    if due is not None:
        fields["截止时间"] = due
    return {k: v for k, v in fields.items() if v is not None}


@router.post("/sync/feishu")
def sync_feishu(
    user: User = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    boards = {b.id: b for b in db.scalars(select(Board)).all()}
    cols = {c.id: c for c in db.scalars(select(BoardColumn)).all()}
    depts = {d.id: d.name for d in db.scalars(select(Department)).all()}
    tasks = db.scalars(
        select(Task).where(Task.deleted_at.is_(None)).order_by(Task.id)
    ).all()

    try:
        fs = FeishuClient(settings.feishu_app_id, settings.feishu_app_secret)
        app_token = fs.resolve_wiki_app_token(settings.feishu_wiki_node)
        table_id = settings.feishu_table_id
        _ensure_fields(fs, app_token, table_id)

        existing = fs.list_records(app_token, table_id, KEY_FIELD)
        to_create, to_update = [], []
        for t in tasks:
            row = _row_for(t, boards, cols, depts)
            rec_id = existing.get(str(t.id))
            if rec_id is None:
                to_create.append(row)
            else:
                to_update.append({"record_id": rec_id, "fields": row})

        fs.batch_create(app_token, table_id, to_create)
        fs.batch_update(app_token, table_id, to_update)
    except FeishuError as e:
        raise HTTPException(status_code=502, detail=f"飞书同步失败：{e}") from None

    return {
        "total": len(tasks),
        "created": len(to_create),
        "updated": len(to_update),
    }
