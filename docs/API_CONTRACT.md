# MVP API 契约（前后端共同遵守）

本文件是本轮 MVP 前后端的**唯一接口真相源**。后端按此实现，前端按此消费。
任何一方需要偏离时，先改本文件并知会另一方。

- Base URL：`http://localhost:8000`，所有业务接口在 `/api` 前缀下。
- 认证：JWT Bearer。登录后前端在请求头带 `Authorization: Bearer <token>`。
- 时间：ISO 8601 字符串（UTC），如 `2026-06-21T10:00:00Z`。`due_date` 精确到分钟，可为 `null`。
- 显示名：所有涉及人名的返回一律是 `full_name`（真名）；`username` 仅登录用。

## 错误格式

非 2xx 统一返回：

```json
{ "detail": "人类可读的错误信息" }
```

常见码：`400` 业务校验失败 / `401` 未认证或 token 失效 / `403` 角色无权 / `404` 不存在 / `409` 状态冲突（如对不在 review 列的任务做审核）。

## 通用对象形状

```jsonc
// User（精简，用于嵌套展示）
{ "id": 1, "full_name": "张三", "role": "member", "department_id": 2 }

// Department
{ "id": 2, "name": "研发部" }

// Board
{ "id": 1, "name": "任务看板", "position": 0 }

// BoardColumn
{ "id": 10, "board_id": 1, "name": "待办", "position": 0, "kind": "start" }
// kind ∈ "start" | "doing" | "review" | "done" | null

// Task（列表/卡片正面用）
{
  "id": 100, "title": "写文档", "description": "……",
  "creator": { "id": 1, "full_name": "张三", "role": "admin", "department_id": 2 },
  "assignee": { "id": 3, "full_name": "李四", "role": "member", "department_id": 2 }, // 可为 null
  "department_id": 2,
  "board_id": 1,
  "column_id": 10,            // open/pending_approval/declined 时为 null
  "lifecycle": "on_board",    // "open" | "pending_approval" | "on_board" | "declined"
  "is_rework": false,
  "priority": "normal",       // "low" | "normal" | "high"
  "is_mandatory": false,
  "due_date": "2026-06-26T18:00:00Z",
  "created_at": "2026-06-21T10:00:00Z",
  "updated_at": "2026-06-21T10:00:00Z"
}

// TaskDetail = Task + 下列字段
{
  "deliverables": [
    { "id": 1, "submitter": {…User}, "note": "见链接", "created_at": "…" }
  ],
  "applications": [   // 仅 lifecycle=open 时有意义
    { "id": 1, "applicant": {…User}, "created_at": "…" }
  ]
}
```

## 端点

### 认证
```
POST /api/auth/register
  body: { "invite_code": "ABC123", "username": "lisi", "password": "secret" }
  200:  { "access_token": "…", "token_type": "bearer", "user": {…User} }
  400:  邀请码无效/已用、用户名已存在

POST /api/auth/login
  body: { "username": "lisi", "password": "secret" }
  200:  { "access_token": "…", "token_type": "bearer", "user": {…User} }
  401:  用户名或密码错误

GET  /api/auth/me
  200:  {…User, "username": "lisi", "account_status": "active" }
```

### 超管（role=super_admin）
```
POST /api/admin/departments         body: { "name": "研发部" }            -> 200 {…Department}
GET  /api/admin/departments         -> 200 [ {…Department} ]
POST /api/admin/users
  body: { "full_name": "李四", "department_id": 2, "role": "member" }
  200:  { "id": 3, "full_name": "李四", "role": "member", "department_id": 2,
          "account_status": "invited", "invite_code": "ABC123" }
GET  /api/admin/users               -> 200 [ {…User, "account_status", "username"|null } ]
PUT  /api/admin/users/{id}
  body: { "role"?: "...", "department_id"?: n, "is_active"?: bool }       -> 200 {…User}
```

### 看板 / 列
```
GET  /api/boards                    -> 200 [ {…Board} ]   // 按部门可见性过滤
GET  /api/boards/{id}/columns       -> 200 [ {…BoardColumn} ]  // 按 position 升序
POST /api/boards/{id}/columns       [super]  body: { "name": "复核", "kind": null } -> 200 {…BoardColumn}
PUT  /api/columns/{cid}             [super]  body: { "name"?, "kind"?, "position"? } -> 200 {…BoardColumn}
DELETE /api/columns/{cid}           [super]  -> 200 { "ok": true }   // 卡片迁移到同看板首列
```

### 任务
```
GET  /api/tasks?board_id=&assignee=&lifecycle=    -> 200 [ {…Task} ]  // 上板任务（lifecycle=on_board）默认
POST /api/tasks
  body: { "title", "description"?, "board_id", "priority"?,
          "assignee_id"?: n,        // 省略 => admin 建的进任务池(open)；member 建 => pending_approval
          "department_id"?: n, "due_date"?: "…" }
  200:  {…Task}
GET  /api/tasks/{id}                -> 200 {…TaskDetail}

POST /api/tasks/{id}/assign         [admin]  body: { "assignee_id": 3 }
  // 指派/转派/从池分派：设 assignee，落到该看板 start 列，lifecycle=on_board -> 200 {…Task}
POST /api/tasks/{id}/approve        [admin]  body: { "approve": true, "assignee_id"?: 3 } | { "approve": false }
  // 审批 member 自提任务：通过+指派 -> start 列；拒绝 -> declined -> 200 {…Task}
POST /api/tasks/{id}/move           body: { "column_id": 11 }
  // 拖拽改列。member 只能移自己的卡，且不能直接移入 done 列 -> 200 {…Task}
POST /api/tasks/{id}/start          [assignee member]  // start 列 -> doing 列 -> 200 {…Task}
POST /api/tasks/{id}/submit         [assignee member]  body: { "note": "产出说明" }  // doing -> review -> 200 {…Task}
POST /api/tasks/{id}/review         [admin]  body: { "approve": true } | { "approve": false, "comment": "打回原因" }
  // 通过 -> done 列；打回 -> 退回 doing 列，is_rework=true -> 200 {…Task}
```

### 任务池
```
GET  /api/pool?board_id=            -> 200 [ {…Task} ]   // lifecycle=open，按部门隔离
POST /api/tasks/{id}/apply          [member]            -> 200 { "ok": true }   // 记 TaskApplication，任务仍留池
GET  /api/tasks/{id}/applications   [admin]             -> 200 [ {…application} ]
```

## 角色动作显隐（前端按此渲染按钮）

| 角色 | 所在列 kind / lifecycle | 可见动作 |
|---|---|---|
| member | start（且是 assignee） | 开始 |
| member | doing（且是 assignee） | 提交产出 |
| member | open（池中） | 申请 |
| admin | review | 审核（通过/打回） |
| admin | pending_approval | 审批（通过+指派/拒绝） |
| admin | open（池中） | 分派（给自己/成员/申请人） |
| admin | 任意上板卡 | 指派/转派、移动列 |
| super_admin | 看板列头 | 加列/改列/删列 |

## 默认数据（seed 提供，便于前端联调）

- super_admin：`username=super / password=super123`
- admin（研发部）：`username=admin / password=admin123`
- member（研发部）：`username=member / password=member123`
- 默认「任务看板」：列 `待办(start)` → `进行中(doing)` → `待审核(review)` → `已完成(done)`
- 若干处于不同列的任务 + 2~3 个任务池(open)任务

---

# 第二轮：延后功能接口（标签 / 清单 / 每周必做 / 文件 / 通知 / 统计 / 气泡池）

模型已在第一轮建好（spec §4）。本轮加端点 + 前端。沿用第一轮的错误格式、JWT、显示名(full_name)规则。

## Task / TaskDetail 形状增补（前后端共同遵守）

第一轮的 `Task`（卡片正面用）**新增**两个字段，后端所有返回 Task 的地方都要带上：

```jsonc
{
  // …第一轮字段不变…
  "tags": [ { "id": 1, "name": "紧急", "color": "red" } ],   // 该卡的彩色标签，无则 []
  "checklist_stats": { "done": 2, "total": 5 }               // 清单进度；无清单则 {done:0,total:0}
}
```

`TaskDetail` 在第一轮基础上**再新增**：

```jsonc
{
  // …Task 全部字段 + 第一轮的 deliverables / applications…
  "checklists": [
    { "id": 1, "title": "上线前检查", "position": 0,
      "items": [ { "id": 1, "content": "跑测试", "is_done": true, "position": 0 } ] }
  ],
  "attachments": [
    { "id": 1, "owner_type": "task", "owner_id": 100, "filename": "spec.pdf",
      "filesize": 12345, "content_type": "application/pdf", "uploader": {…User}, "created_at": "…" }
  ]
}
```

产出 Deliverable 也增补 `attachments`（owner_type=deliverable）：
```jsonc
{ "id": 1, "submitter": {…User}, "note": "…", "created_at": "…",
  "attachments": [ {…Attachment} ] }
```

## 标签（彩色 Label）
色板取值（color 字段用这些 key）：`green yellow orange red purple blue sky pink gray`。

```
GET  /api/tags                       -> 200 [ { "id", "name", "color" } ]
POST /api/tags                       body: { "name": "紧急", "color": "red" } -> 200 {…Tag}   [任意登录用户]
PUT  /api/tasks/{id}/tags            body: { "tag_ids": [1,2] }  // 全量覆盖该卡标签
                                     -> 200 [ {…Tag} ]                       [admin / 任务负责人]
```

## 清单（Checklist）
```
POST   /api/tasks/{id}/checklists        body: { "title": "上线检查" } -> 200 {…Checklist(含空 items)}
PUT    /api/checklists/{cid}             body: { "title"?, "position"? } -> 200 {…Checklist}
DELETE /api/checklists/{cid}             -> 200 { "ok": true }
POST   /api/checklists/{cid}/items       body: { "content": "跑测试" } -> 200 {…ChecklistItem}
PUT    /api/checklist-items/{iid}        body: { "is_done"?, "content"?, "position"? } -> 200 {…ChecklistItem}
DELETE /api/checklist-items/{iid}        -> 200 { "ok": true }
```
权限：能编辑该任务的人（admin 或负责人）。

## 每周必做（Recurring，admin / super_admin）
```
GET    /api/recurring-tasks   -> 200 [ { "id","title","description","priority",
                                        "day_of_week","is_active",
                                        "assignees":[{…User}] } ]
POST   /api/recurring-tasks   body: { "title","description"?,"priority"?,
                                      "day_of_week"?(0=周一…6=周日,默认0),
                                      "assignee_ids":[int] } -> 200 {…RecurringTask}
PUT    /api/recurring-tasks/{id}  body: { 任意上述字段 + "is_active"? } -> 200 {…RecurringTask}
DELETE /api/recurring-tasks/{id}  -> 200 { "ok": true }
POST   /api/recurring-tasks/{id}/run-now  -> 200 { "created": n }   // 立即按模板生成本周实例（运维/测试用）
```
- **自动生成**：APScheduler 每天检查；当天 = `day_of_week` 时，为每个指派人各生成一个 Task：
  `is_mandatory=true`、`recurring_task_id` 指向模板、落「任务看板」`start` 列、`lifecycle=on_board`、**截止固定本周五 18:00**。
- 生成逻辑抽成纯函数 `generate_recurring_instances(db, today)` 便于单测；`run-now` 与 scheduler 都调它。
- admin 只能给本部门成员设；super_admin 全局。

## 文件（本地磁盘）
```
POST /api/files/upload    multipart/form-data: file=<二进制>, owner_type=task|deliverable, owner_id=<int>
                          -> 200 {…Attachment}     [对该 owner 有编辑权的人；单文件 ≤50MB；类型白名单]
GET  /api/files/{id}      -> 200 二进制下载(Content-Disposition)   [仅任务相关人，否则 403]
```
存储路径 `./uploads/{year}/{uuid}-{filename}`，DB 存元信息。

## 通知（站内 + 轮询）
```
GET  /api/notifications              -> 200 [ { "id","type","message","related_task_id",
                                               "is_read","created_at" } ]  // 倒序，最近 N 条
POST /api/notifications/{id}/read    -> 200 { "ok": true }
POST /api/notifications/read-all     -> 200 { "ok": true }
```
后端在这些事件写通知给相应用户：被指派(→负责人)、池任务被申请(→本部门 admin)、产出提交(→可审核的 admin)、审核通过/打回(→负责人)。前端每 30s 轮询，顶栏铃铛显示未读数（= is_read=false 计数）。

## 统计（admin / super_admin）
```
GET /api/stats/overview?board_id=   -> 200 {
  "by_column": [ { "column_id","name","count" } ],   // 当前看板各列任务数
  "pool_count": n,                                    // 该看板任务池数
  "overdue_count": n                                  // 逾期(due_date<now 且未完成)数
}
GET /api/stats/members              -> 200 [ {
  "user": {…User}, "total","done","in_review","overdue" } ]
```
权限：super_admin 全局；admin 本部门。基于 Task 实时聚合，不建新表。

## 前端（本轮新增/改造）
- **卡片正面**：顶部彩色标签条；清单进度徽章 `☑ 2/5`(全完成变绿)；📎 附件数；🔁 必做徽章；📝 有描述。
- **卡片详情 Modal**：新增 **标签**(选色板/新建/切换)、**清单**(多清单+进度条+勾选+增删项+改名)、**附件**(上传/列表/下载，产出提交可带附件) 三个区块。
- **每周必做管理页** `/recurring`(admin/super)：列表 + 新建(标题/描述/优先级/星期几/指派人) + 启停 + 删除。
- **统计面板页** `/stats`(admin/super)：概览卡片+图表(切看板随之变) + 人员表格(点人名筛其任务，弹任务详情)。
- **通知**：顶栏铃铛 + 每 30s 轮询未读数 + 下拉通知列表 + 标记已读。
- **任务池气泡视图**：列表/气泡一键切换(localStorage 记忆)；气泡 CSS 缓慢漂浮，大小/亮度按 priority(越紧急越显眼)，分派后破裂飞走。
