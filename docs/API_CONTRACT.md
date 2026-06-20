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
