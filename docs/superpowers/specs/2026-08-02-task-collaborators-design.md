# 任务多人协作（协作人）设计

日期：2026-08-02

## 目标

任务支持多人协作：一个任务除主负责人外可以有若干协作人；协作人能看到任务、能推进任务、飞书通知时被一并 @ 到。

## 语义决策

采用「主负责人 + 协作人」模型，而不是完全平等的多 assignee：

- `Task.assignee_id` 保持不变，仍是唯一的主负责人。
- 新增协作人列表，协作人拥有与主负责人相同的**工作权限**，但不拥有**管理权限**。
- 统计口径（人均任务数、周报、矩阵图、导出）只算主负责人，协作人不重复计入。

理由：现有的统计、审核、逾期归属、部门归属逻辑全部建立在单一 `assignee_id` 之上；引入平等多 assignee 需要重新定义这些口径并做数据迁移，收益不匹配。协作人模型完全覆盖「都能看到」和「@ 多人」的诉求。

## 1. 数据模型

新增中间表：

```python
class TaskCollaborator(Base):
    __tablename__ = "task_collaborators"

    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id"), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
```

`Task` 上新增关系：

```python
collaborators: Mapped[list["User"]] = relationship(
    secondary="task_collaborators", order_by="User.id"
)
```

形态与已有的 `RecurringTaskAssignee` 一致。

Alembic 迁移只建表，无数据迁移（存量任务协作人为空）。迁移文件需同步到 `backend/alembic/versions/`（部署流程要求）。

## 2. 权限与可见性

在 `services.py` 新增一个 helper 收口现有散落的身份判断：

```python
def is_task_worker(user: User, task: Task) -> bool:
    """主负责人或协作人 —— 有权推进这个任务的人。"""

def can_edit_task(user: User, task: Task) -> bool:
    """admin scope 或 is_task_worker。"""
```

改动点：

| 位置 | 改动 |
| --- | --- |
| `services.can_edit_task` | 标签/清单/附件编辑权加入协作人 |
| `routers/tasks._visible_to` | member 分支加入协作人，协作人可见任务 |
| `routers/tasks.py:394` 移动卡片 | `task.assignee_id != user.id` → `not is_task_worker(...)` |
| `routers/tasks.py:490` 开始任务 | 同上 |
| `routers/tasks.py:513` 提交产出 | 同上 |

不改动（仍限管理员 + 主负责人）：

- `admin_can_touch_task`
- 审核 / 打回接口
- 删除任务
- 重新指派
- 修改协作人名单本身

## 3. API

### 协作人名单

```
PUT /tasks/{id}/collaborators
body: { "user_ids": [int, ...] }
```

全量覆盖语义。权限：admin scope 或主负责人。返回 `TaskDetailOut`。

副作用：

- 新增的人：站内通知 + 单独一张飞书卡片（header `👥 加入协作`）@ 到本人
- 移出的人：仅站内通知，不推飞书

### Schema

- `TaskOut` / `TaskDetailOut` / `LinkedTaskOut` 新增 `collaborators: list[UserOut] = []`
- `TaskIn`（创建）与 `AssignIn`（指派）新增可选 `collaborator_ids: list[int] = []`，支持一步到位

### 列表筛选

`GET /tasks?assignee=X` 的条件从 `Task.assignee_id == X` 改为：

```
Task.assignee_id == X OR EXISTS(
    SELECT 1 FROM task_collaborators
    WHERE task_id = tasks.id AND user_id = X
)
```

### 不改动

统计（`routers/stats.py`）、周报、矩阵图、导出全部不变——它们继续只按 `assignee_id` 归属。这是选择本模型的直接收益。

## 4. 飞书通知

`feishu.build_task_card` 的参数 `assignee_open_id` / `assignee_name` 合并为：

```python
mentions: list[tuple[str | None, str]]   # (open_id, full_name)
```

逐人渲染：有 `open_id` 输出 `<at id=...></at>`，没有则输出 `@姓名`（退化为纯文本，非真 @）。同一行以空格分隔。所有调用点相应更新。

- 创建 / 指派 / 推送卡片：@ 主负责人 + 全部协作人
- 评论卡片：@ `{主负责人, 创建人, *协作人} - {评论者}`
- 加入协作卡片：@ 新增的协作人

## 5. 任务流转

- **退回需求池**（`return_to_pool`）：清空协作人名单，逐人发站内通知
- **重新指派**：保留协作人名单；若新主负责人原本在协作名单中，从名单移除以避免重复。去重逻辑放在 `services.apply_assignee`

## 6. 前端

- `api/types.ts`：`Task` 新增 `collaborators: User[]`
- `CardDetailModal`：主负责人下方新增「协作人」行，展示头像组；管理员与主负责人可见编辑入口（多选用户选择器，参考 `RecurringPage` 的 `assignee_ids` 表单）。`canEdit` 判断加入协作人
- `TaskCard`：右下角改为头像组，主负责人在前、协作人叠加显示，超过 3 个显示 `+N`
- `BoardPage:258`：`mineOnly` 是前端本地过滤，条件改为 `t.assignee?.id === user?.id || t.collaborators.some(c => c.id === user?.id)`；卡片上以角标区分「协作」

## 7. 测试

后端（`backend/tests/`）：

- 协作人可见任务、可编辑标签/清单/附件、可移动卡片、可提交产出
- 协作人不可修改协作人名单、不可重新指派、不可审核
- 退回需求池后协作人被清空
- 重新指派保留协作人，且新主负责人从协作名单去重
- `test_feishu_card.py` 补多人 @ 的卡片快照，含「部分人无 open_id」的混合场景

前端：

- `TaskCard` 头像组渲染与 `+N` 折叠
- `CardDetailModal` 协作人编辑入口的权限可见性
- `mineOnly` 过滤包含协作任务

## 非目标

- 不引入平等多 assignee
- 不改变任何统计口径
- 不为协作人增加独立的通知偏好设置
