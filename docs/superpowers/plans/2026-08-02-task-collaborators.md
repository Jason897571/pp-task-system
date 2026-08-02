# 任务多人协作（协作人）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给任务增加「协作人」——协作人能看到任务、能推进任务、飞书通知时被一并 @ 到，而主负责人（`Task.assignee_id`）与所有统计口径保持不变。

**Architecture:** 新增 `task_collaborators` 多对多中间表（形态照抄已有的 `recurring_task_assignees`）。后端把散落在各处的 `task.assignee_id == user.id` 判断收口到 `services.is_task_worker()`，让协作人自动获得工作权限；飞书卡片的单人 @ 参数改成多人 `mentions` 列表。统计、周报、矩阵图、导出一行不改。

**Tech Stack:** FastAPI + SQLAlchemy 2.0 (Mapped/mapped_column) + Alembic + MySQL；前端 React + TypeScript + antd + @tanstack/react-query；测试 pytest（后端）/ vitest（前端）。

## Global Constraints

- 设计依据：`docs/superpowers/specs/2026-08-02-task-collaborators-design.md`
- `Task.assignee_id` 语义不变，仍是唯一主负责人；不引入平等多 assignee
- 统计（`backend/app/routers/stats.py`）、周报、矩阵图、导出**禁止修改**，继续只按 `assignee_id` 归属
- 协作人**没有**管理权限：不能改协作人名单、不能重新指派、不能审核/打回、不能删除任务
- Alembic 新迁移的 `down_revision` 必须是当前 head `f0a1b2c3d4e5`；迁移文件放在 `backend/alembic/versions/`（部署流程从这里读）
- 后端测试命令：`cd backend && source .venv/bin/activate && python -m pytest -q`
- 前端测试命令：`cd frontend && npm run test`
- 中文用户可见文案；代码注释沿用仓库现有的英文风格

---

### Task 1: 数据模型与迁移

**Files:**
- Modify: `backend/app/models.py`（`Task` 类，约 124-175 行；新增 `TaskCollaborator` 类）
- Create: `backend/alembic/versions/a2b3c4d5e6f7_add_task_collaborators.py`
- Test: `backend/tests/test_collaborators.py`

**Interfaces:**
- Consumes: 无（第一个任务）
- Produces:
  - `app.models.TaskCollaborator`，表名 `task_collaborators`，主键 `(task_id, user_id)`
  - `Task.collaborators: list[User]`，按 `User.id` 排序，后续所有任务都依赖这个属性

- [ ] **Step 1: 写失败的测试**

创建 `backend/tests/test_collaborators.py`：

```python
"""Tests for task collaborators (multi-person collaboration)."""

from app.models import Task
from tests.factory import standard_world


def test_task_collaborators_round_trip(db):
    w = standard_world(db)
    task = Task(
        title="协作任务",
        creator_id=w["admin"].id,
        assignee_id=w["member"].id,
        board_id=w["board"].id,
        department_id=w["rnd"].id,
        column_id=w["cols"]["start"].id,
        lifecycle="on_board",
    )
    task.collaborators = [w["member2"]]
    db.add(task)
    db.commit()
    db.refresh(task)

    assert [c.id for c in task.collaborators] == [w["member2"].id]
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd backend && source .venv/bin/activate && python -m pytest tests/test_collaborators.py -q
```

Expected: FAIL — `AttributeError: 'Task' object has no attribute 'collaborators'`

- [ ] **Step 3: 加模型**

在 `backend/app/models.py` 的 `Task` 类里，`tags` 关系旁边加：

```python
    collaborators: Mapped[list["User"]] = relationship(
        secondary="task_collaborators", order_by="User.id"
    )
```

在 `Task` 类之后（`Tag` 类之前的任意位置）新增：

```python
class TaskCollaborator(Base):
    """A task's co-workers. The task still has exactly one assignee (the owner);
    collaborators get the same *work* permissions but no management rights."""

    __tablename__ = "task_collaborators"

    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id"), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd backend && source .venv/bin/activate && python -m pytest tests/test_collaborators.py -q
```

Expected: PASS（conftest 的 `_schema` fixture 用 `Base.metadata.create_all` 建表，不依赖 alembic）

- [ ] **Step 5: 写迁移**

创建 `backend/alembic/versions/a2b3c4d5e6f7_add_task_collaborators.py`：

```python
"""add task_collaborators

Revision ID: a2b3c4d5e6f7
Revises: f0a1b2c3d4e5
"""

import sqlalchemy as sa
from alembic import op

revision: str = 'a2b3c4d5e6f7'
down_revision: str | None = 'f0a1b2c3d4e5'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "task_collaborators",
        sa.Column("task_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("task_id", "user_id"),
    )


def downgrade() -> None:
    op.drop_table("task_collaborators")
```

- [ ] **Step 6: 验证迁移能跑**

```bash
cd backend && source .venv/bin/activate && alembic upgrade head && alembic downgrade -1 && alembic upgrade head
```

Expected: 三条命令都成功，无 "Multiple head revisions" 错误

- [ ] **Step 7: 提交**

```bash
git add backend/app/models.py backend/alembic/versions/a2b3c4d5e6f7_add_task_collaborators.py backend/tests/test_collaborators.py
git commit -m "feat: task_collaborators 表与 Task.collaborators 关系"
```

---

### Task 2: 权限 helper `is_task_worker`

**Files:**
- Modify: `backend/app/services.py:216-221`（`can_edit_task`）
- Test: `backend/tests/test_collaborators.py`

**Interfaces:**
- Consumes: `Task.collaborators`（Task 1）
- Produces:
  - `services.is_task_worker(user: User, task: Task) -> bool` —— 主负责人或协作人
  - `services.can_edit_task(user: User, task: Task) -> bool` —— 语义扩展为 admin scope 或 `is_task_worker`

- [ ] **Step 1: 写失败的测试**

追加到 `backend/tests/test_collaborators.py`：

```python
from app.services import can_edit_task, is_task_worker


def _make_task(db, w, assignee, collaborators=()):
    task = Task(
        title="协作任务",
        creator_id=w["admin"].id,
        assignee_id=assignee.id,
        board_id=w["board"].id,
        department_id=w["rnd"].id,
        column_id=w["cols"]["start"].id,
        lifecycle="on_board",
    )
    task.collaborators = list(collaborators)
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def test_is_task_worker_covers_assignee_and_collaborators(db):
    w = standard_world(db)
    task = _make_task(db, w, w["member"], [w["member2"]])

    assert is_task_worker(w["member"], task) is True
    assert is_task_worker(w["member2"], task) is True
    assert is_task_worker(w["mkt_member"], task) is False


def test_collaborator_can_edit_task(db):
    w = standard_world(db)
    task = _make_task(db, w, w["member"], [w["member2"]])

    assert can_edit_task(w["member2"], task) is True
    assert can_edit_task(w["mkt_member"], task) is False
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd backend && source .venv/bin/activate && python -m pytest tests/test_collaborators.py -q
```

Expected: FAIL — `ImportError: cannot import name 'is_task_worker'`

- [ ] **Step 3: 实现**

在 `backend/app/services.py` 里把 `can_edit_task` 替换为：

```python
def is_task_worker(user: User, task: Task) -> bool:
    """Who is working on this task: the assignee (owner) or any collaborator.
    Work permissions only — managing the task (reassign, review, delete, editing
    the collaborator list) still requires admin scope or the assignee."""
    if task.assignee_id == user.id:
        return True
    return any(c.id == user.id for c in task.collaborators)


def can_edit_task(user: User, task: Task) -> bool:
    """Who may edit a task's tags/checklists/attachments: admin scope or a worker."""
    if admin_can_touch_task(user, task):
        return True
    return is_task_worker(user, task)
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd backend && source .venv/bin/activate && python -m pytest tests/test_collaborators.py -q
```

Expected: PASS

- [ ] **Step 5: 跑全量后端测试确认无回归**

```bash
cd backend && source .venv/bin/activate && python -m pytest -q
```

Expected: 全部通过

- [ ] **Step 6: 提交**

```bash
git add backend/app/services.py backend/tests/test_collaborators.py
git commit -m "feat: is_task_worker 收口主负责人/协作人的工作权限判断"
```

---

### Task 3: API 输出 collaborators

**Files:**
- Modify: `backend/app/schemas.py`（`TaskOut` 约 90-110 行；`LinkedTaskOut` 约 185-200 行）
- Modify: `backend/app/services.py:339-355`（`serialize_linked_task`）
- Test: `backend/tests/test_collaborators.py`

**Interfaces:**
- Consumes: `Task.collaborators`（Task 1）
- Produces: `TaskOut.collaborators: list[UserOut]`，因为 `TaskDetailOut(TaskOut)` 继承，详情接口自动带上；`serialize_task` 走 `model_validate(task)`，无需改动。`LinkedTaskOut.collaborators` 同名字段，由 `serialize_linked_task` 手工填

- [ ] **Step 1: 写失败的测试**

追加到 `backend/tests/test_collaborators.py`：

```python
from tests.conftest import auth_header


def test_task_detail_returns_collaborators(client, db):
    w = standard_world(db)
    task = _make_task(db, w, w["member"], [w["member2"]])
    h = auth_header(client, "admin", "pw")

    resp = client.get(f"/api/tasks/{task.id}", headers=h)

    assert resp.status_code == 200, resp.text
    assert [c["id"] for c in resp.json()["collaborators"]] == [w["member2"].id]
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd backend && source .venv/bin/activate && python -m pytest tests/test_collaborators.py::test_task_detail_returns_collaborators -q
```

Expected: FAIL — `KeyError: 'collaborators'`

- [ ] **Step 3: 实现**

在 `backend/app/schemas.py` 的 `TaskOut` 里，`assignee: UserOut | None` 下一行加：

```python
    collaborators: list[UserOut] = []
```

在 `LinkedTaskOut` 里，`assignee: UserOut | None = None` 下一行加同样的字段：

```python
    collaborators: list[UserOut] = []
```

`backend/app/services.py` 的 `serialize_linked_task`，在 `assignee=...` 那行之后加：

```python
        collaborators=[UserOut.model_validate(c) for c in t.collaborators],
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd backend && source .venv/bin/activate && python -m pytest tests/test_collaborators.py -q
```

Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add backend/app/schemas.py backend/app/services.py backend/tests/test_collaborators.py
git commit -m "feat: TaskOut/TaskDetailOut/LinkedTaskOut 输出 collaborators"
```

---

### Task 4: 可见性与工作权限接入

**Files:**
- Modify: `backend/app/routers/tasks.py:102-119`（`_visible_to`）
- Modify: `backend/app/routers/tasks.py:393-395`（`move_task` 的 member 分支）
- Modify: `backend/app/routers/tasks.py:490-491`（`start_task`）
- Modify: `backend/app/routers/tasks.py:513-514`（`submit_task`）
- Modify: `backend/app/routers/tasks.py:36-55`（`from app.services import ...` 加 `is_task_worker`）
- Test: `backend/tests/test_collaborators.py`

**Interfaces:**
- Consumes: `services.is_task_worker`、`services.can_edit_task`（Task 2）；`TaskOut.collaborators`（Task 3）
- Produces: 无新符号，只改行为

- [ ] **Step 1: 写失败的测试**

追加到 `backend/tests/test_collaborators.py`：

```python
def test_collaborator_can_see_and_move_task(client, db):
    w = standard_world(db)
    task = _make_task(db, w, w["member"], [w["member2"]])
    h = auth_header(client, "member2", "pw")

    assert client.get(f"/api/tasks/{task.id}", headers=h).status_code == 200

    resp = client.post(
        f"/api/tasks/{task.id}/move",
        json={"column_id": w["cols"]["doing"].id},
        headers=h,
    )
    assert resp.status_code == 200, resp.text


def test_non_collaborator_cannot_see_task(client, db):
    w = standard_world(db)
    task = _make_task(db, w, w["member"])
    h = auth_header(client, "mkt_member", "pw")

    assert client.get(f"/api/tasks/{task.id}", headers=h).status_code == 403


def test_collaborator_can_start_and_submit(client, db):
    w = standard_world(db)
    task = _make_task(db, w, w["member"], [w["member2"]])
    h = auth_header(client, "member2", "pw")

    assert client.post(f"/api/tasks/{task.id}/start", headers=h).status_code == 200
    resp = client.post(f"/api/tasks/{task.id}/submit", json={"note": "做完了"}, headers=h)
    assert resp.status_code == 200, resp.text
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd backend && source .venv/bin/activate && python -m pytest tests/test_collaborators.py -q
```

Expected: FAIL —— 上面三个用例返回 403

- [ ] **Step 3: 改 `_visible_to`**

`backend/app/routers/tasks.py` 里把 `_visible_to` 的前半段替换为（把 worker/creator 判断提到角色分支之前，这样身为协作人的 admin 也一定看得到）：

```python
def _visible_to(db: Session, user: User, task: Task) -> bool:
    if user.role == "super_admin":
        return True
    # assignee, collaborators and the creator always see their own card
    if is_task_worker(user, task) or task.creator_id == user.id:
        return True
    if user.role == "admin" and admin_can_touch_task(user, task):
        return True
    # anyone may view an open pool task within their visible board + department
    # (needed to open the detail before applying); mirrors the /pool filter.
    if (
        task.lifecycle == "open"
        and task.department_id == user.department_id
        and board_can_see(db, user, task.board_id)
    ):
        return True
    return False
```

并在文件顶部的 `from app.services import (...)` 里加入 `is_task_worker,`（按字母序放在 `hard_delete_task,` 之后）。

- [ ] **Step 4: 改三处工作权限判断**

`move_task` 的 member 分支：

```python
    if user.role == "member":
        if not is_task_worker(user, task):
            raise HTTPException(status_code=403, detail="只能移动自己的任务")
```

`start_task`：

```python
    if not is_task_worker(user, task):
        raise HTTPException(status_code=403, detail="只能开始自己的任务")
```

`submit_task`：

```python
    if not can_edit_task(user, task):
        raise HTTPException(status_code=403, detail="无权提交该任务的产出")
```

- [ ] **Step 5: 跑测试确认通过**

```bash
cd backend && source .venv/bin/activate && python -m pytest -q
```

Expected: 全部通过（含既有 `test_flows.py` / `test_round2.py`）

- [ ] **Step 6: 提交**

```bash
git add backend/app/routers/tasks.py backend/tests/test_collaborators.py
git commit -m "feat: 协作人可见任务并可移动/开始/提交"
```

---

### Task 5: 协作人名单接口

**Files:**
- Modify: `backend/app/schemas.py`（`# ---- request bodies ----` 段落，新增 `CollaboratorsIn`）
- Modify: `backend/app/routers/tasks.py`（`assign_task` 之后新增路由；import 里加 `CollaboratorsIn`）
- Modify: `backend/app/routers/users.py:79-81`（`list_assignable_users` 放开给所有登录用户）
- Test: `backend/tests/test_collaborators.py`

**Interfaces:**
- Consumes: `services.is_task_worker`（Task 2）、`TaskOut.collaborators`（Task 3）
- Produces: `PUT /api/tasks/{task_id}/collaborators`，body `{"user_ids": [int, ...]}`，返回 `TaskDetailOut`

**说明：** `GET /api/users`（下拉候选人）目前是 `require_admin`。设计允许主负责人改协作人名单，主负责人可能是 member，所以这里把依赖换成 `get_current_user`；非 super_admin 仍然只看得到本部门的在职 admin/member，范围不变。

- [ ] **Step 1: 写失败的测试**

追加到 `backend/tests/test_collaborators.py`：

```python
from app.models import Notification


def test_assignee_can_set_collaborators(client, db):
    w = standard_world(db)
    task = _make_task(db, w, w["member"])
    h = auth_header(client, "member", "pw")

    resp = client.put(
        f"/api/tasks/{task.id}/collaborators",
        json={"user_ids": [w["member2"].id]},
        headers=h,
    )

    assert resp.status_code == 200, resp.text
    assert [c["id"] for c in resp.json()["collaborators"]] == [w["member2"].id]
    notes = db.scalars(
        select(Notification).where(Notification.user_id == w["member2"].id)
    ).all()
    assert any("协作" in n.message for n in notes)


def test_setting_collaborators_drops_removed_and_notifies(client, db):
    w = standard_world(db)
    task = _make_task(db, w, w["member"], [w["member2"]])
    h = auth_header(client, "admin", "pw")

    resp = client.put(
        f"/api/tasks/{task.id}/collaborators", json={"user_ids": []}, headers=h
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["collaborators"] == []
    notes = db.scalars(
        select(Notification).where(Notification.user_id == w["member2"].id)
    ).all()
    assert any("移出" in n.message for n in notes)


def test_collaborator_list_excludes_the_assignee(client, db):
    w = standard_world(db)
    task = _make_task(db, w, w["member"])
    h = auth_header(client, "admin", "pw")

    resp = client.put(
        f"/api/tasks/{task.id}/collaborators",
        json={"user_ids": [w["member"].id, w["member2"].id]},
        headers=h,
    )

    assert resp.status_code == 200, resp.text
    assert [c["id"] for c in resp.json()["collaborators"]] == [w["member2"].id]


def test_collaborator_cannot_edit_the_collaborator_list(client, db):
    w = standard_world(db)
    task = _make_task(db, w, w["member"], [w["member2"]])
    h = auth_header(client, "member2", "pw")

    resp = client.put(
        f"/api/tasks/{task.id}/collaborators", json={"user_ids": []}, headers=h
    )

    assert resp.status_code == 403
```

文件顶部补上 `from sqlalchemy import select`。

- [ ] **Step 2: 跑测试确认失败**

```bash
cd backend && source .venv/bin/activate && python -m pytest tests/test_collaborators.py -q
```

Expected: FAIL —— 405 Method Not Allowed（路由不存在）

- [ ] **Step 3: 加请求体 schema**

`backend/app/schemas.py` 的 `class AssignIn` 附近加：

```python
class CollaboratorsIn(BaseModel):
    user_ids: list[int] = []
```

- [ ] **Step 4: 加路由**

`backend/app/routers/tasks.py` 在 `assign_task` 之后加：

```python
@router.put("/tasks/{task_id}/collaborators", response_model=TaskDetailOut)
def set_collaborators(
    task_id: int,
    body: CollaboratorsIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Replace the task's collaborator list (full overwrite). Only admin scope or
    the assignee may manage it — collaborators can work on the task but not
    change who else is on it. The assignee is filtered out of the list so nobody
    is both owner and collaborator."""
    task = db.get(Task, task_id)
    if task is None or task.deleted_at is not None:
        raise HTTPException(status_code=404, detail="任务不存在")
    if not (admin_can_touch_task(user, task) or task.assignee_id == user.id):
        raise HTTPException(status_code=403, detail="无权修改协作人")

    wanted = [uid for uid in dict.fromkeys(body.user_ids) if uid != task.assignee_id]
    people = (
        list(db.scalars(select(User).where(User.id.in_(wanted))).all()) if wanted else []
    )
    if len(people) != len(wanted):
        raise HTTPException(status_code=404, detail="协作人不存在")

    before = {c.id for c in task.collaborators}
    task.collaborators = people
    after = {u.id for u in people}
    for u in people:
        if u.id not in before:
            notify(db, u.id, "collaborator", f"你被加入任务「{task.title}」的协作", task.id)
    for uid in before - after:
        notify(db, uid, "collaborator", f"你已被移出任务「{task.title}」的协作", task.id)
    log_activity(db, task, user, "collaborators")
    db.commit()
    db.refresh(task)
    return serialize_task_detail(db, task)
```

在 import 的 schemas 块里加 `CollaboratorsIn,`（放在 `CommentIn` 之前，保持字母序）。

**注意：** 新增协作人的飞书卡片放在 Task 8 一起做——`_feishu_task_card` 现在还是单人签名（`mention: User | None`），Task 8 改成多人后再接。本任务只发站内通知。

- [ ] **Step 5: 放开候选人列表**

`backend/app/routers/users.py` 把：

```python
def list_assignable_users(
    user: User = Depends(require_admin), db: Session = Depends(get_db)
):
```

改成：

```python
def list_assignable_users(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
```

并确认 `get_current_user` 已在该文件 import（若无，从 `app.deps` 导入）。若 `require_admin` 在改完后不再被该文件使用，删掉它的 import。

- [ ] **Step 6: 跑测试确认通过**

```bash
cd backend && source .venv/bin/activate && python -m pytest -q
```

Expected: 全部通过

- [ ] **Step 7: 提交**

```bash
git add backend/app/schemas.py backend/app/routers/tasks.py backend/app/routers/users.py backend/tests/test_collaborators.py
git commit -m "feat: PUT /tasks/{id}/collaborators 管理协作人名单"
```

---

### Task 6: 创建/指派带协作人、重新指派去重、退回池清空

**Files:**
- Modify: `backend/app/schemas.py`（`TaskIn`、`AssignIn`）
- Modify: `backend/app/services.py`（`apply_assignee`，约 134-143 行）
- Modify: `backend/app/routers/tasks.py`（`create_task`、`assign_task`、`task_to_pool`）
- Test: `backend/tests/test_collaborators.py`

**Interfaces:**
- Consumes: `Task.collaborators`（Task 1）
- Produces:
  - `TaskIn.collaborator_ids: list[int] = []`
  - `AssignIn.collaborator_ids: list[int] | None = None`（`None` = 保持不变）
  - `apply_assignee` 副作用扩展：把新主负责人从协作名单中去掉

- [ ] **Step 1: 写失败的测试**

追加到 `backend/tests/test_collaborators.py`：

```python
def test_create_task_with_collaborators(client, db):
    w = standard_world(db)
    h = auth_header(client, "admin", "pw")

    resp = client.post(
        "/api/tasks",
        json={
            "title": "带协作人的任务",
            "board_id": w["board"].id,
            "assignee_id": w["member"].id,
            "collaborator_ids": [w["member2"].id],
        },
        headers=h,
    )

    assert resp.status_code == 200, resp.text
    assert [c["id"] for c in resp.json()["collaborators"]] == [w["member2"].id]


def test_reassign_keeps_collaborators_and_dedupes(client, db):
    w = standard_world(db)
    task = _make_task(db, w, w["member"], [w["member2"]])
    h = auth_header(client, "admin", "pw")

    resp = client.post(
        f"/api/tasks/{task.id}/assign", json={"assignee_id": w["member2"].id}, headers=h
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["assignee"]["id"] == w["member2"].id
    # the new owner is dropped from the collaborator list; the old owner is NOT
    # auto-added as a collaborator
    assert resp.json()["collaborators"] == []


def test_to_pool_clears_collaborators(client, db):
    w = standard_world(db)
    task = _make_task(db, w, w["member"], [w["member2"]])
    h = auth_header(client, "admin", "pw")

    resp = client.post(f"/api/tasks/{task.id}/to-pool", headers=h)

    assert resp.status_code == 200, resp.text
    assert resp.json()["collaborators"] == []
    notes = db.scalars(
        select(Notification).where(Notification.user_id == w["member2"].id)
    ).all()
    assert any("需求池" in n.message for n in notes)
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd backend && source .venv/bin/activate && python -m pytest tests/test_collaborators.py -q
```

Expected: FAIL —— 创建接口忽略 `collaborator_ids`，重新指派后 `collaborators` 仍含新主负责人

- [ ] **Step 3: 改 schema**

`backend/app/schemas.py`：

```python
class TaskIn(BaseModel):
    title: str
    description: str | None = None
    board_id: int
    priority: str | None = "normal"
    assignee_id: int | None = None
    collaborator_ids: list[int] = []
    department_id: int | None = None
    due_date: datetime | None = None
```

`AssignIn` 加一行（`None` 表示不改动名单）：

```python
    collaborator_ids: list[int] | None = None
```

- [ ] **Step 4: `apply_assignee` 去重**

`backend/app/services.py`：

```python
    task.assignee_id = assignee.id
    # Nobody is both owner and collaborator — a reassign to an existing
    # collaborator promotes them out of the collaborator list.
    task.collaborators = [c for c in task.collaborators if c.id != assignee.id]
    if assignee.department_id is not None:
        task.department_id = assignee.department_id
```

- [ ] **Step 5: 路由接线**

`backend/app/routers/tasks.py` 新增一个私有 helper（放在 `_name` 附近）：

```python
def _resolve_collaborators(db: Session, ids: list[int], assignee_id: int | None) -> list[User]:
    """Look up collaborator users, dropping duplicates and the assignee. 404s if
    any id is unknown."""
    wanted = [uid for uid in dict.fromkeys(ids) if uid != assignee_id]
    if not wanted:
        return []
    people = list(db.scalars(select(User).where(User.id.in_(wanted))).all())
    if len(people) != len(wanted):
        raise HTTPException(status_code=404, detail="协作人不存在")
    return people
```

`create_task`：在 `db.commit()` 之前（`if task.id is None: db.add(task)` 之后）加：

```python
    if body.collaborator_ids:
        if task.id is None:
            db.add(task)
            db.flush()
        task.collaborators = _resolve_collaborators(
            db, body.collaborator_ids, task.assignee_id
        )
        for c in task.collaborators:
            notify(db, c.id, "collaborator", f"你被加入任务「{task.title}」的协作", task.id)
```

`assign_task`：在 `log_activity(...)` 之前加：

```python
    if body.collaborator_ids is not None:
        task.collaborators = _resolve_collaborators(
            db, body.collaborator_ids, task.assignee_id
        )
```

`task_to_pool`：把 `task.assignee_id = None` 那段替换为：

```python
    former_assignee_id = task.assignee_id
    former_collaborator_ids = [c.id for c in task.collaborators]
    task.lifecycle = "open"
    task.assignee_id = None
    task.column_id = None
    # returning to the pool re-opens the task, so the collaboration ends too
    task.collaborators = []
```

并在原有的 `if former_assignee_id is not None:` 通知之后加：

```python
    for uid in former_collaborator_ids:
        notify(
            db,
            uid,
            "to_pool",
            f"任务「{task.title}」已被放回需求池",
            task.id,
        )
```

- [ ] **Step 6: 跑测试确认通过**

```bash
cd backend && source .venv/bin/activate && python -m pytest -q
```

Expected: 全部通过

- [ ] **Step 7: 提交**

```bash
git add backend/app/schemas.py backend/app/services.py backend/app/routers/tasks.py backend/tests/test_collaborators.py
git commit -m "feat: 创建/指派可带协作人,重新指派去重,退回池清空协作人"
```

---

### Task 7: 列表按协作人筛选

**Files:**
- Modify: `backend/app/routers/tasks.py:135-136`（`list_tasks` 的 assignee 过滤）
- Modify: `backend/app/routers/tasks.py`（import 里加 `TaskCollaborator`）
- Test: `backend/tests/test_collaborators.py`

**Interfaces:**
- Consumes: `models.TaskCollaborator`（Task 1）
- Produces: `GET /api/tasks?assignee=X` 同时返回 X 主负责与 X 协作的任务

- [ ] **Step 1: 写失败的测试**

追加到 `backend/tests/test_collaborators.py`：

```python
def test_task_list_by_assignee_includes_collaborations(client, db):
    w = standard_world(db)
    task = _make_task(db, w, w["member"], [w["member2"]])
    h = auth_header(client, "admin", "pw")

    resp = client.get(f"/api/tasks?assignee={w['member2'].id}", headers=h)

    assert resp.status_code == 200, resp.text
    assert [t["id"] for t in resp.json()] == [task.id]
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd backend && source .venv/bin/activate && python -m pytest tests/test_collaborators.py::test_task_list_by_assignee_includes_collaborations -q
```

Expected: FAIL —— 返回空列表

- [ ] **Step 3: 实现**

`backend/app/routers/tasks.py` 把：

```python
    if assignee is not None:
        stmt = stmt.where(Task.assignee_id == assignee)
```

改为：

```python
    if assignee is not None:
        # "someone's tasks" = owned OR collaborated on
        stmt = stmt.where(
            (Task.assignee_id == assignee)
            | select(TaskCollaborator.task_id)
            .where(
                TaskCollaborator.task_id == Task.id,
                TaskCollaborator.user_id == assignee,
            )
            .exists()
        )
```

并在 `from app.models import (...)` 里加 `TaskCollaborator,`（放在 `Task,` 之后）。

- [ ] **Step 4: 跑测试确认通过**

```bash
cd backend && source .venv/bin/activate && python -m pytest -q
```

Expected: 全部通过

- [ ] **Step 5: 提交**

```bash
git add backend/app/routers/tasks.py backend/tests/test_collaborators.py
git commit -m "feat: /tasks?assignee 包含协作任务"
```

---

### Task 8: 飞书卡片 @ 多人

**Files:**
- Modify: `backend/app/feishu.py:63-92`（`build_task_card` 签名与 @ 行渲染）
- Modify: `backend/app/routers/tasks.py:71-86`（`_feishu_task_card`）及其 4 处调用（约 351、541、603、639 行）
- Modify: `backend/tests/test_feishu_card.py`
- Test: `backend/tests/test_feishu_card.py`

**Interfaces:**
- Consumes: `Task.collaborators`（Task 1）
- Produces:
  - `feishu.build_task_card(..., mentions: Sequence[tuple[str | None, str]] = ())` —— 取代 `assignee_open_id` / `assignee_name` 两个参数
  - `routers.tasks._feishu_task_card(task, mentions: list[User], header, footer, extra=None)`
  - `routers.tasks._mention_users(*users: User | None) -> list[User]` —— 去 None、按 id 去重、保序

- [ ] **Step 1: 写失败的测试**

改写 `backend/tests/test_feishu_card.py` 的 `_card` helper：

```python
def _card(**over):
    kwargs = dict(
        header="📌 新任务指派",
        footer="指派人：李四",
        title="优化首页加载速度",
        priority="high",
        due_date="2026-07-20",
        description="把首屏 LCP 降到 2s 以内",
        mentions=[("ou_abc", "张三")],
    )
    kwargs.update(over)
    return build_task_card(**kwargs)
```

把文件里其余用到 `assignee_open_id=` / `assignee_name=` 的用例改成 `mentions=`：无 open_id 的场景写 `mentions=[(None, "张三")]`，无 @ 的场景写 `mentions=[]`。并追加：

```python
def test_card_mentions_multiple_people():
    body = _body(_card(mentions=[("ou_a", "张三"), ("ou_b", "李四")]))
    assert "<at id=ou_a></at>" in body
    assert "<at id=ou_b></at>" in body


def test_card_mixes_real_and_plain_mentions():
    """People without a feishu open_id degrade to a plain @name in the same line."""
    body = _body(_card(mentions=[("ou_a", "张三"), (None, "李四")]))
    assert "<at id=ou_a></at>" in body
    assert "@李四" in body
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd backend && source .venv/bin/activate && python -m pytest tests/test_feishu_card.py -q
```

Expected: FAIL — `TypeError: build_task_card() got an unexpected keyword argument 'mentions'`

- [ ] **Step 3: 改 `build_task_card`**

`backend/app/feishu.py`：把签名里的

```python
    assignee_open_id: str | None = None,
    assignee_name: str | None = None,
```

替换为

```python
    mentions: Sequence[tuple[str | None, str]] = (),
```

（文件顶部 import `from collections.abc import Sequence`）

把 docstring 里描述 @ 的那句改成：

```
    `mentions` is a list of (feishu_open_id, full_name) pairs; each becomes a real
    <at id=...> when the open_id is known, else a plain @name (text only, not a
    real mention). All of them share one line. Empty list => no mention line.
```

把渲染段：

```python
    if assignee_open_id:
        lines += [f"<at id={assignee_open_id}></at>", ""]
    elif assignee_name:
        lines += [f"@{assignee_name}", ""]
```

替换为：

```python
    if mentions:
        at = [f"<at id={oid}></at>" if oid else f"@{name}" for oid, name in mentions]
        lines += [" ".join(at), ""]
```

- [ ] **Step 4: 跑卡片测试确认通过**

```bash
cd backend && source .venv/bin/activate && python -m pytest tests/test_feishu_card.py -q
```

Expected: PASS

- [ ] **Step 5: 改调用方**

`backend/app/routers/tasks.py`：

```python
def _mention_users(*users: User | None) -> list[User]:
    """De-duplicate a mention list by user id, dropping Nones, keeping order."""
    out: list[User] = []
    seen: set[int] = set()
    for u in users:
        if u is not None and u.id not in seen:
            seen.add(u.id)
            out.append(u)
    return out


def _feishu_task_card(
    task: Task, mentions: list[User], header: str, footer: str, extra: str | None = None
) -> None:
    """Post a task card (title / DDL / priority / detail, @-mentioning everyone in
    `mentions`) to the group bot. `extra` appends one more body line (e.g. a comment)."""
    card = build_task_card(
        header=header,
        footer=footer,
        title=task.title,
        priority=task.priority,
        due_date=_due_text(task),
        description=task.description,
        mentions=[(u.feishu_open_id, u.full_name) for u in mentions],
        extra=extra,
        link_url=f"{settings.app_base_url.rstrip('/')}/board/{task.board_id}/card/{task.id}",
    )
    post_bot_card(settings.feishu_bot_webhook, card)
```

各处调用改成：

- 需求被拒绝（约 351 行）：`_feishu_task_card(task, _mention_users(task.creator), "🚫 需求被拒绝", f"审批人：{_name(user)}")`
- 待审核（约 541 行）：`_feishu_task_card(task, _mention_users(task.creator), "🔍 待审核", f"提交人：{_name(user)}")`
- 任务推送（约 603 行）：`_feishu_task_card(task, _mention_users(task.assignee, *task.collaborators), "📌 任务推送", f"推送人：{_name(user)}")`

Task 5 的 `set_collaborators` 里，`db.refresh(task)` 与 `return` 之间补上新增协作人的卡片（Task 5 里留的空）：

```python
    added = [u for u in people if u.id not in before]
    if added:
        _feishu_task_card(task, added, "👥 加入协作", f"操作人：{_name(user)}")
```

评论那处（约 632-641 行）把 `recipient` 逻辑整段替换为：

```python
    # Always push the comment to the group bot so it's visible to everyone;
    # @-mention everyone involved (assignee + collaborators + creator) except the
    # commenter. Nobody left => post the card without an @-mention.
    recipients = [
        u
        for u in _mention_users(task.assignee, *task.collaborators, task.creator)
        if u.id != user.id
    ]
    snippet = text if len(text) <= 100 else text[:100] + "…"
    _feishu_task_card(
        task, recipients, "💬 新评论", f"评论人：{_name(user)}", extra=f"**💬 评论**　{snippet}"
    )
```

同时把上面的站内通知循环从：

```python
    for uid in {task.assignee_id, task.creator_id} - {None, user.id}:
```

改成：

```python
    involved = {task.assignee_id, task.creator_id} | {c.id for c in task.collaborators}
    for uid in involved - {None, user.id}:
```

- [ ] **Step 6: 跑全量测试确认通过**

```bash
cd backend && source .venv/bin/activate && python -m pytest -q
```

Expected: 全部通过。若有残留的 `assignee_open_id=` 调用会以 `TypeError` 暴露——用 `grep -rn "assignee_open_id\|assignee_name" backend/` 确认已清零。

- [ ] **Step 7: 提交**

```bash
git add backend/app/feishu.py backend/app/routers/tasks.py backend/tests/test_feishu_card.py
git commit -m "feat: 飞书卡片支持 @ 多人(主负责人+协作人)"
```

---

### Task 9: 前端类型、接口与卡片头像组

**Files:**
- Modify: `frontend/src/api/types.ts`（`Task` 接口，约 96-118 行）
- Modify: `frontend/src/api/endpoints.ts`（新增 `setCollaborators`）
- Modify: `frontend/src/components/TaskCard.tsx:98-108`
- Test: `frontend/src/components/TaskCard.test.tsx`

**Interfaces:**
- Consumes: 后端 `TaskOut.collaborators`（Task 3）、`PUT /tasks/{id}/collaborators`（Task 5）
- Produces:
  - `Task.collaborators: User[]`
  - `setCollaborators(id: number, user_ids: number[]): Promise<TaskDetail>`

- [ ] **Step 1: 写失败的测试**

先给 `frontend/src/components/TaskCard.test.tsx` 里的 `makeTask` 默认值加一行（放在 `assignee: null,` 之后）：

```tsx
    collaborators: [],
```

在同一文件顶部加一个 person helper（放在 `makeTask` 之后）：

```tsx
const person = (id: number, name: string) => ({
  id,
  full_name: name,
  role: 'member' as const,
  department_id: 1,
  avatar_attachment_id: null,
  card_color: null,
})
```

追加用例：

```tsx
describe('CardFront collaborators', () => {
  it('renders an avatar for each collaborator next to the assignee', () => {
    const task = makeTask({
      assignee: person(1, '张三'),
      collaborators: [person(2, '李四'), person(3, '王五')],
    })
    render(<CardFront task={task} columnKind="doing" />)
    expect(screen.getByTitle('协作人：李四')).toBeInTheDocument()
    expect(screen.getByTitle('协作人：王五')).toBeInTheDocument()
  })

  it('collapses more than three collaborators into a +N badge', () => {
    const task = makeTask({
      assignee: person(1, '张三'),
      collaborators: [2, 3, 4, 5].map((id) => person(id, `协作${id}`)),
    })
    render(<CardFront task={task} columnKind="doing" />)
    expect(screen.getByText('+2')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd frontend && npm run test -- TaskCard
```

Expected: FAIL —— 找不到 `协作人：李四`

- [ ] **Step 3: 加类型与接口**

`frontend/src/api/types.ts` 的 `Task` 接口里，`assignee: User | null` 下一行加：

```ts
  collaborators: User[]
```

`frontend/src/api/endpoints.ts` 在 `assignTask` 附近加：

```ts
// Replace a task's collaborator list (full overwrite). Admin scope or the assignee.
export const setCollaborators = (id: number, user_ids: number[]) =>
  api.put<TaskDetail>(`/tasks/${id}/collaborators`, { user_ids }).then((r) => r.data)
```

（`TaskDetail` 若在该文件中是别的名字，用文件里已有的详情类型名。）

- [ ] **Step 4: 改卡片渲染**

`frontend/src/components/TaskCard.tsx` 把：

```tsx
      {(chips.length > 0 || task.assignee) && (
        <>
          <div className="card-divider" />
          <div className="card-meta">
            <div className="meta-chips">{chips}</div>
            {task.assignee && (
              <UserAvatar user={task.assignee} size={26} className="card-av" />
            )}
          </div>
        </>
      )}
```

改成：

```tsx
      {(chips.length > 0 || task.assignee || task.collaborators.length > 0) && (
        <>
          <div className="card-divider" />
          <div className="card-meta">
            <div className="meta-chips">{chips}</div>
            <div className="card-avs">
              {task.assignee && (
                <UserAvatar user={task.assignee} size={26} className="card-av" />
              )}
              {task.collaborators.slice(0, 3).map((c) => (
                <span key={c.id} title={`协作人：${c.full_name}`}>
                  <UserAvatar user={c} size={22} className="card-av collab" />
                </span>
              ))}
              {task.collaborators.length > 3 && (
                <span className="card-av-more">+{task.collaborators.length - 3}</span>
              )}
            </div>
          </div>
        </>
      )}
```

在卡片样式所在的 CSS 文件（与 `.card-av` 同一处）加：

```css
.card-avs { display: flex; align-items: center; gap: 2px; }
.card-avs .collab { margin-left: -6px; }
.card-av-more { font-size: 11px; color: var(--muted, #999); margin-left: 2px; }
```

- [ ] **Step 5: 跑测试确认通过**

```bash
cd frontend && npm run test
```

Expected: 全部通过（其他用例若因 `Task` 新增必填字段报类型错，给它们的 mock 补 `collaborators: []`）

- [ ] **Step 6: 提交**

```bash
git add frontend/src/api/types.ts frontend/src/api/endpoints.ts frontend/src/components/TaskCard.tsx frontend/src/components/TaskCard.test.tsx
git commit -m "feat: 卡片显示协作人头像组"
```

---

### Task 10: 前端动作显隐与拖拽认可协作人

**Files:**
- Modify: `frontend/src/lib/actions.ts:15-64`（`ActionContext`、`isAssignee`、`visibleActions`、`canDrag`、`adjacentColumns`）
- Test: `frontend/src/lib/actions.test.ts`

**Interfaces:**
- Consumes: `Task.collaborators`（Task 9）
- Produces: `actions.isWorker(task: Pick<Task, 'assignee' | 'collaborators'>, meId: number): boolean` —— 前端版的 `is_task_worker`，供 `CardDetailModal`（Task 11）与 `BoardPage`（Task 12）复用

**为什么需要这一步：** `visibleActions` 只给 assignee 显示「开始 / 提交」，`canDrag` 只让 assignee 拖自己的卡。后端已经允许协作人做这些事（Task 4），前端不同步的话协作人会看到一张自己动不了的卡。

- [ ] **Step 1: 写失败的测试**

`frontend/src/lib/actions.test.ts` 顶部的 `onBoard` helper 改成能带协作人（保持原签名可用）：

```ts
const person = (id: number) => ({
  id,
  full_name: 'X',
  role: 'member' as const,
  department_id: 1,
  avatar_attachment_id: null,
  card_color: null,
})

const onBoard = (
  assigneeId: number | null,
  collaboratorIds: number[] = [],
): ActionContext['task'] => ({
  lifecycle: 'on_board',
  assignee: assigneeId ? person(assigneeId) : null,
  collaborators: collaboratorIds.map(person),
})
```

追加用例：

```ts
describe('collaborators', () => {
  it('sees 开始 in the start column as a collaborator', () => {
    expect(
      visibleActions({ task: onBoard(2, [1]), columnKind: 'start', me: member }),
    ).toEqual(['start'])
  })

  it('sees 提交 in the doing column as a collaborator', () => {
    expect(
      visibleActions({ task: onBoard(2, [1]), columnKind: 'doing', me: member }),
    ).toEqual(['submit'])
  })

  it('lets a collaborator drag the card', () => {
    expect(canDrag(onBoard(2, [1]), member)).toBe(true)
  })

  it('still blocks a member who is neither assignee nor collaborator', () => {
    expect(canDrag(onBoard(2, [3]), member)).toBe(false)
    expect(visibleActions({ task: onBoard(2, [3]), columnKind: 'start', me: member })).toEqual([])
  })

  it('isWorker covers assignee and collaborators only', () => {
    expect(isWorker(onBoard(1, [2]), 1)).toBe(true)
    expect(isWorker(onBoard(1, [2]), 2)).toBe(true)
    expect(isWorker(onBoard(1, [2]), 3)).toBe(false)
  })
})
```

import 行加上 `isWorker`：

```ts
import { adjacentColumns, canDrag, canDropInto, isWorker, visibleActions } from './actions'
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd frontend && npm run test -- actions
```

Expected: FAIL —— `isWorker is not a function`，且协作人用例返回空数组 / false

- [ ] **Step 3: 实现**

`frontend/src/lib/actions.ts`：

`ActionContext.task` 的 Pick 加上 `collaborators`：

```ts
export interface ActionContext {
  task: Pick<Task, 'lifecycle' | 'assignee' | 'collaborators'>
  columnKind: ColumnKind // kind of the task's current column (null if not on board)
  requiresReview?: boolean // task's current column is the board's review gate
  me: Pick<User, 'id' | 'role'>
}
```

把 `isAssignee` 替换为导出的 `isWorker`（mirrors the backend's `is_task_worker`）：

```ts
// Who may work on a card: the assignee (owner) or any collaborator. Mirrors the
// backend's services.is_task_worker.
export function isWorker(
  task: Pick<Task, 'assignee' | 'collaborators'>,
  meId: number,
): boolean {
  if (task.assignee?.id === meId) return true
  return task.collaborators.some((c) => c.id === meId)
}
```

`visibleActions` 的 member 分支：

```ts
    if (task.lifecycle === 'on_board' && isWorker(task, me.id)) {
```

`canDrag`：

```ts
export function canDrag(
  task: Pick<Task, 'assignee' | 'collaborators'>,
  me: Pick<User, 'id' | 'role'>,
): boolean {
  if (me.role === 'member') return isWorker(task, me.id)
  return true // admin / super_admin
}
```

`adjacentColumns` 的 task 参数类型：

```ts
export function adjacentColumns(
  columns: BoardColumn[],
  task: Pick<Task, 'assignee' | 'collaborators' | 'column_id'>,
  me: Pick<User, 'id' | 'role'>,
): { prev: BoardColumn | null; next: BoardColumn | null } {
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd frontend && npm run test
```

Expected: 全部通过（其余文件里构造 Task/ActionContext 的 mock 若缺 `collaborators` 会报类型错，补 `collaborators: []`）

- [ ] **Step 5: 提交**

```bash
git add frontend/src/lib/actions.ts frontend/src/lib/actions.test.ts
git commit -m "feat: 前端动作显隐与拖拽认可协作人"
```

---

### Task 11: 详情页协作人展示与编辑

**Files:**
- Modify: `frontend/src/components/CardDetailModal.tsx`（候选人查询约 52-57 行；`canEdit` / `canCompose` 约 157-168 行；`cm-chips` 区块约 364-372 行）
- Modify: 卡片详情样式文件（`.cm-chip` 所在的 CSS）

**Interfaces:**
- Consumes: `Task.collaborators`、`setCollaborators`（Task 9）、`actions.isWorker`（Task 10）、`getAssignableUsers`（已有）
- Produces: 无对外符号

**验证方式：** 该组件没有既有测试文件，且依赖 react-query + antd + auth context，为它新建渲染测试的成本远高于收益。本任务靠 `npm run build`（类型检查）与既有测试套件不回归来验证，权限逻辑本身已在 Task 10 的纯函数里测过。

- [ ] **Step 1: 改权限判断**

`frontend/src/components/CardDetailModal.tsx`：

```tsx
  // Edit permission for tags/checklists/attachments: admin/super_admin, the
  // assignee, or a collaborator.
  const isManager = user?.role === 'admin' || user?.role === 'super_admin'
  const worker = !!task && !!user && isWorker(task, user.id)
  const canEdit = !!task && !!user && (isManager || worker)
  // Only admin scope or the assignee may manage who else works on the card.
  const canManageCollaborators =
    !!task && !!user && (isManager || task.assignee?.id === user.id)
```

`canCompose` 改成：

```tsx
  const canCompose = !!task && !!user && columnKind === 'doing' && (isManager || worker)
```

import 里加 `isWorker`（来自 `../lib/actions`，与已有的 `adjacentColumns` 合并成一行）。

- [ ] **Step 2: 放开候选人查询**

主负责人可能是 member，而后端已在 Task 5 把 `/users` 放开给所有登录用户，所以去掉 `enabled`：

```tsx
  // Candidate people for assign/approve and the collaborator editor.
  const { data: users = [] } = useQuery({
    queryKey: ['assignable-users'],
    queryFn: getAssignableUsers,
  })
```

- [ ] **Step 3: 展示协作人**

在 `cm-chips` 区块里，负责人 chip（`task.assignee ? ... : 未指派`）之后插入：

```tsx
              {task.collaborators.map((c) => (
                <span className="cm-chip collab" key={c.id} title="协作人">
                  <UserAvatar user={c} size={18} />
                  {c.full_name}
                </span>
              ))}
              {canManageCollaborators && (
                <button
                  type="button"
                  className="cm-chip ghost"
                  onClick={() => {
                    setCollabDraft(task.collaborators.map((c) => c.id))
                    setEditingCollabs(true)
                  }}
                >
                  ＋协作人
                </button>
              )}
```

- [ ] **Step 4: 加编辑弹窗**

在其他 `useState` / `useMutation` 附近加：

```tsx
  const [editingCollabs, setEditingCollabs] = useState(false)
  const [collabDraft, setCollabDraft] = useState<number[]>([])
  const collabM = useMutation({
    mutationFn: (ids: number[]) => setCollaborators(taskId, ids),
  })
```

在组件返回的 JSX 末尾（与其他 Modal 同级）加：

```tsx
      <Modal
        open={editingCollabs}
        title="编辑协作人"
        onCancel={() => setEditingCollabs(false)}
        onOk={() =>
          wrap(() => collabM.mutateAsync(collabDraft), '协作人已更新').then(() =>
            setEditingCollabs(false),
          )
        }
        confirmLoading={collabM.isPending}
      >
        <Select
          mode="multiple"
          style={{ width: '100%' }}
          placeholder="选择协作人"
          value={collabDraft}
          onChange={setCollabDraft}
          optionFilterProp="label"
          options={users
            .filter((u) => u.id !== task?.assignee?.id)
            .map((u) => ({ value: u.id, label: u.full_name }))}
        />
      </Modal>
```

补齐 import：`setCollaborators` 来自 `../api/endpoints`；`Modal` / `Select` 来自 `antd`（按文件现有 import 风格合并）。

- [ ] **Step 5: 加样式**

在 `.cm-chip` 所在的 CSS 文件里加：

```css
.cm-chip.collab { opacity: 0.85; }
.cm-chip.ghost { background: transparent; border: 1px dashed var(--border, #d9d9d9); cursor: pointer; }
```

- [ ] **Step 6: 验证**

```bash
cd frontend && npm run build && npm run test
```

Expected: build 无 TypeScript 报错；测试全部通过

- [ ] **Step 7: 提交**

```bash
git add frontend/src/components/CardDetailModal.tsx frontend/src/
git commit -m "feat: 详情页展示并可编辑协作人"
```

---

### Task 12: 「只看我的」包含协作任务

**Files:**
- Modify: `frontend/src/pages/BoardPage.tsx:258`

**Interfaces:**
- Consumes: `actions.isWorker`（Task 10）
- Produces: 无对外符号

**验证方式：** 一行过滤条件的改动，复用 Task 10 已测过的 `isWorker`；靠 `npm run build` 与全量测试不回归验证。

- [ ] **Step 1: 实现**

`frontend/src/pages/BoardPage.tsx` 把：

```tsx
  const inScope = (t: Task) => !mineOnly || t.assignee?.id === user?.id
```

改成：

```tsx
  // "mine" = cards I own or collaborate on
  const inScope = (t: Task) => !mineOnly || (!!user && isWorker(t, user.id))
```

import 里加 `isWorker`（来自 `../lib/actions`，与该文件已有的 actions import 合并）。

- [ ] **Step 2: 前后端全量回归**

```bash
cd backend && source .venv/bin/activate && python -m pytest -q
cd ../frontend && npm run test && npm run build
```

Expected: pytest 全绿；vitest 全绿；`npm run build` 无 TypeScript 报错

- [ ] **Step 3: 提交**

```bash
git add frontend/src/pages/BoardPage.tsx
git commit -m "feat: 只看我的包含协作任务"
```

---

## 部署提醒

上线时按 `DEPLOY.md` 流程执行，`alembic upgrade head` 会建 `task_collaborators` 表。迁移文件已在 `backend/alembic/versions/`，无需额外同步。
