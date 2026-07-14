# 任务完成时间 completed_at 设计

日期：2026-07-13

## 背景

系统目前没有独立的"完成时间"字段。两个"按周"功能各用一个近似值：

- 归档看板「按周视图」用 `archived_at`（每周六批量归档时才写入）
- 周报导出用 `updated_at` 近似完成时间（`export.py` 顶部注释已说明这是权宜之计）

本需求新增真正的完成时间字段 `completed_at`，仅用于统计（用来算每周完成的任务）。

## 决策口径

1. **完成时刻**：卡片进入"最终验收完成列"（`BoardColumn.is_final = True`）时算完成。
2. **移出行为**：离开验收列**不清空** completed_at；再次进入验收列时**覆盖**为新时间戳。
3. **消费方**：本次只记录并通过 API 返回字段，**暂不接入**任何统计（周报导出、归档按周视图保持不变）。
4. **历史回填**：已归档任务用 `archived_at` 回填 completed_at。

## 实现

### 数据模型

`backend/app/models.py` 的 `Task` 新增：

```python
completed_at = Column(DateTime, nullable=True)  # 进入最终验收列(is_final)的时刻，仅用于统计
```

时区沿用现有约定（UTC naive，与 `archived_at` 一致）。

同步：
- `backend/app/schemas.py` 的 `TaskOut` 增加 `completed_at: datetime | None`
- `frontend/src/api/types.ts` 的 `Task` 增加 `completed_at?: string | null`

### 写入逻辑

新增 helper（放在 `services.py`），在任何把卡片 `column_id` 改成新列、且**列真正发生变化**时调用；若新列 `is_final` 为真则写入当前时间：

```python
def stamp_completion(task, new_column):
    if new_column and new_column.is_final:
        task.completed_at = <now, UTC naive>
```

接入的落列路径（`backend/app/routers/tasks.py`）：

- `move_task()` — 拖拽移动（column_id 变化时）
- `approve_task()` — 审批通过落列
- `move_task_to_board()` — 从归档还原到目标看板
- `restore_to_origin()` — 一键还原到原看板 final 列

不触发的场景：
- `submit_task()` 进的是 done 列而非 final 列，不触发
- 周六归档扫描时卡片已在 final 列、时间戳早已写入，无需改动
- 同列内排序、编辑标题等不改 column_id 的操作不触发

### 历史回填（Alembic 迁移）

```sql
ALTER TABLE task ADD COLUMN completed_at DATETIME NULL;
UPDATE task SET completed_at = archived_at WHERE archived_at IS NOT NULL;
```

## 验收标准

1. 把一张卡片移入 is_final 列 → 该任务 `completed_at` 被写入、接口返回非空。
2. 把卡片移出再移回 is_final 列 → `completed_at` 更新为最后一次进入的时间。
3. 移出 is_final 列后 → `completed_at` 保持不变（不清空）。
4. 同列内移动/编辑标题 → `completed_at` 不变。
5. 迁移执行后，已归档任务的 `completed_at` 等于其 `archived_at`。
6. 周报导出、归档按周视图行为不变。
