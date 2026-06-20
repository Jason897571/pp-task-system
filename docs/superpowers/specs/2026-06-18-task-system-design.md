# 任务分配系统 — 设计文档

日期：2026-06-18
修订：
- 2026-06-19 看板前端与功能对齐 Trello（彩色标签、清单、截止徽章、卡片详情弹窗，见 §7）。
- 2026-06-19 看板升级为**多看板（二级看板）+ 可配置工作流 + 部门可见性**；任务池由「直接领取」改为「member 申请 / admin 分派」；截止时间精确到分钟（datetime）。

状态：已确认设计，待评审

> **看板模型（核心）**：系统下可有多个**二级看板**（如「任务看板」「合同看板」），每个看板有自己的一套**列（工作流阶段）**与卡片。**super_admin 可编辑工作流**（增删列、改列名、调序，新建/删除/改名看板），并设置**每个看板对哪些部门可见**。admin / member 只读使用配置好的看板。列的语义角色 `kind`（start/doing/review/done/自定义）驱动角色动作按钮，因此即便列被改名/新增，业务流转仍然成立（见 §3）。

## 1. 概述

面向**小团队（几人到几十人）的内部任务分配工具**。支持登录、部门划分、角色权限，admin 发布并分配任务，member 完成后上传产出，admin 验收，并提供管理统计面板。

- 前端：React + Vite + TypeScript
- 后端：FastAPI + SQLAlchemy 2.0 + Alembic + Pydantic + APScheduler（生成每周必做任务）
- 数据库：MySQL
- 认证：JWT
- 文件：本地磁盘存储

## 2. 角色与组织

- **super_admin（超级管理员）**：系统级，不属于具体业务部门。创建部门、预置用户（填真名+部门+角色，生成邀请码）、禁用账号。看全局。
- **admin（部门管理员）**：发布任务、指派/转派任务、审核产出、审批 member 自提任务。管理面板看本部门 + 自己创建或参与的任务。
- **member（成员）**：查看分配给自己的任务、自提任务；开始任务、提交产出。不能审核、不能指派他人。

### 用户注册流程（邀请码）

1. super_admin 预置一条用户记录：填写 **真名（full_name）+ 部门 + 角色（admin/member）**，不设用户名密码，系统生成一次性 **邀请码**，此记录状态为 `invited`。
2. 用户自助注册：输入邀请码 + 自选 **用户名 + 密码** → 绑定到该预置记录，状态变 `active`，邀请码作废。
3. **显示名规则**：全系统所有任务、负责人、活动日志展示的人名一律用 **full_name（真名）**；username 仅用于登录。

组织规则：
- 每个用户属于**一个**部门，在该部门有一个角色。
- admin 可以**跨部门分配任务**（协作场景）。
- admin 可以把任务发给另一个 admin，后者再转派给 member（委派链路），用活动日志记录。

## 3. 看板、工作流与任务生命周期

### 3.1 看板（二级看板）与工作流（列）

- 系统下可有**多个二级看板**（如「任务看板」「合同看板」），每个看板有**自己的一套列（工作流阶段）**和卡片。
- **super_admin 可编辑工作流**：对任意看板**增删列、改列名、调列序**，也可**新建 / 删除 / 改名看板**。admin、member 只读使用配置好的看板。
- 列有语义角色 `kind`：`start`（起始）/ `doing`（进行）/ `review`（待审核）/ `done`（完成）/ `null`（自定义阶段）。`kind` 驱动**角色动作按钮**（开始 / 提交 / 审核 / 验收），自定义列只作为普通拖拽阶段。
- **默认「任务看板」**的列即经典流程：`待办(start)` → `进行中(doing)` → `待审核(review)` → `已完成(done)`。「合同看板」等其他看板可定义完全不同的列（如 `草拟 → 审批中 → 法务复核 → 已签署`）。

### 3.2 任务生命周期

任务先有一个**生命周期元状态** `lifecycle`，上板后再用**所在列** `column_id` 表示进度：

```
[未上板]  open（任务池，未指派）
          pending_approval（member 自提，待审批）
          declined（被拒）

[已上板 on_board]  落在所属看板的某一列，进度 = 列的 kind
   start 列 ──开始──▶ doing 列 ──提交产出──▶ review 列 ──审核通过──▶ done 列
                          ▲                      │
                          └─────── 打回重做 ───────┘   (is_rework=true，可多轮)
```

关键流程：
- **任务池（open）**：admin 创建任务时若**不指派**接收人 → `lifecycle=open`，进入对应看板的任务池。
  - **member 申请**：member 对池中任务提交**申请**（写 `TaskApplication`），任务仍留在池中，并通知本部门 admin。
  - **admin 分派**：admin 把池中任务**直接分派给某成员或自己**（可从申请人里挑）→ 设 `assignee`，落到该看板的 `start` 列，`lifecycle=on_board`，离开池子。
- **member 自提**：member 创建任务 → `pending_approval`，无接收人；admin **通过并指派** → 落 `start` 列；或**拒绝** → `declined`。
- **转派**：当前接收人（admin）改 `assignee_id`，写 `reassigned` 活动日志。
- **开始 / 提交 / 审核**：member 在 `start` 列点开始 → `doing` 列；在 `doing` 列提交产出 → `review` 列；admin 在 `review` 列**审核通过** → `done` 列，或**打回** → 退回 `doing` 列并置 `is_rework=true`（带反馈），member 可再次提交。
- **拖拽**：列间拖拽即改 `column_id`；member 只能拖自己的卡，且不能直接拖入 `done` 列（完成须经审核）。
- **产出保留多轮历史**：打回重做后能看到前后版本。

## 4. 数据模型

```
Department
  id, name, created_at

User
  id
  full_name      (真名，super_admin 预置；全系统显示名)
  username       (登录名，注册时用户自选；invited 阶段为空)
  password_hash  (注册时设置；invited 阶段为空)
  email          (可空)
  invite_code    (一次性邀请码，注册后作废/置空)
  account_status ('invited' | 'active')
  department_id  (FK, 可空——super_admin 无部门)
  role ('super_admin' | 'admin' | 'member')
  is_active, created_at

Board  (二级看板：任务看板 / 合同看板 …)
  id, name, position, created_at

BoardColumn  (看板的列 / 工作流阶段；super_admin 可增删、改名、排序)
  id, board_id (FK Board), name, position
  kind ('start' | 'doing' | 'review' | 'done' | null)
       — 语义角色，驱动角色动作按钮；自定义列 kind=null

BoardVisibility  (看板对部门可见性，多对多；某看板无任何记录 = 全部部门可见)
  board_id (FK Board), department_id (FK Department)

Task
  id, title, description
  creator_id (FK User)
  assignee_id (FK User, 可空——pending_approval / open 时无接收人)
  department_id (任务归属部门)
  board_id (FK Board)                      所属二级看板
  column_id (FK BoardColumn, 可空)          当前列（=进度/状态）；open / pending_approval / declined 时为空
  lifecycle ('open' | 'pending_approval' | 'on_board' | 'declined')
            open=任务池待领取；pending_approval=自提待审批；on_board=已上板（看 column_id）；declined=被拒
  is_rework (bool, 被打回重做标记)
  priority ('low' | 'normal' | 'high')
  is_mandatory (bool, 必做任务标记)
  recurring_task_id (FK RecurringTask, 可空——由每周必做模板生成时填入)
  due_date (datetime, 精确到分钟, 可空)
  created_at, updated_at

TaskApplication  (任务池：member 申请认领，admin 据此分派)
  id, task_id (FK Task), applicant_id (FK User), created_at

RecurringTask  (每周必做任务模板)
  id, title, description
  creator_id (FK User)
  department_id
  priority
  day_of_week  (每周第几天生成，默认周一)
  is_active    (停用后不再生成)
  created_at

RecurringTaskAssignee  (模板的指派人，多对多)
  recurring_task_id (FK), user_id (FK)

Tag  (彩色标签 / Trello Label：卡片正面显示色条)
  id, name, color   (color 用 Trello 风格色板：绿/黄/橙/红/紫/蓝/天蓝/粉/灰)

TaskTag  (任务-标签多对多)
  task_id (FK), tag_id (FK)

Checklist  (卡片清单，一张卡可有多个清单)
  id, task_id (FK), title, position, created_at

ChecklistItem  (清单项)
  id, checklist_id (FK), content, is_done (bool), position, created_at
  — 卡片正面按「已完成/总数」显示进度徽章（如 ✓ 2/5）；全部完成时徽章变绿。

Deliverable  (产出提交，保留多轮历史)
  id, task_id (FK), submitter_id (FK User)
  note (文字说明/链接)
  created_at

Attachment  (统一文件表：任务附件 + 产出文件)
  id
  owner_type ('task' | 'deliverable')
  owner_id   (对应 task.id 或 deliverable.id)
  uploader_id (FK User)
  filename, filepath, filesize, content_type
  created_at

TaskActivity  (任务活动日志——仅后端审计 / 通知来源，前端不展示活动流)
  id, task_id (FK), actor_id (FK User)
  action ('assigned' | 'reassigned' | 'submitted' | 'approved' | 'rejected' | 'commented')
  comment (审核反馈/打回原因，可空)
  created_at

Notification  (站内通知)
  id, user_id (FK 接收者)
  type, message, related_task_id (FK, 可空)
  is_read, created_at
```

## 5. API 设计（FastAPI，均在 /api 下，JWT 鉴权）

```
认证
  POST /auth/login            登录拿 token
  POST /auth/register         注册（邀请码 + 用户名 + 密码）→ 绑定预置记录、激活
  GET  /auth/me               当前用户信息

超管
  POST /admin/departments     建部门
  POST /admin/users           预置用户（真名+部门+角色）→ 返回邀请码
  PUT  /admin/users/{id}      改角色 / 调部门 / 禁用
  POST /admin/users/{id}/reset-invite  重新生成邀请码（未注册时）

看板 / 工作流（super_admin 可编辑；其余角色只读）
  GET    /boards                      我可见的看板列表（按部门可见性过滤）
  POST   /boards                      新建看板（带默认列）           [super]
  PUT    /boards/{id}                  改名 / 排序                    [super]
  DELETE /boards/{id}                  删除看板（及其卡片）           [super]
  PUT    /boards/{id}/visibility       设置可见部门（部门 id 数组；空=全部）[super]
  GET    /boards/{id}/columns          看板的列
  POST   /boards/{id}/columns          加列（name + kind）            [super]
  PUT    /columns/{cid}                改列名 / kind / 排序           [super]
  DELETE /columns/{cid}                删列（卡片迁移到同看板其他列）  [super]

任务池
  GET  /pool?board_id=                 某看板的 open 任务（按看板可见性 + 部门隔离）
  POST /tasks/{id}/apply               member 申请认领（记 TaskApplication，任务仍留池）
  GET  /tasks/{id}/applications        该任务的申请人（admin 据此分派）

任务
  GET  /tasks                 列表（按角色过滤 + 状态/部门/负责人/tag 筛选）
                              支持 ?status= &assignee= &tags=x,y &department=
  POST /tasks                 创建（admin 发布 / member 自提）
  GET  /tasks/{id}            详情（含附件、产出历史、活动日志、tag）
  PUT  /tasks/{id}            改详情
  POST /tasks/{id}/assign     指派 / 转派 / **从任务池分派**给某成员或自己（→ start 列，lifecycle=on_board）
  POST /tasks/{id}/approve    审批 member 自提任务（通过+指派 / 拒绝）
  POST /tasks/{id}/move       拖拽改列（body: column_id）→ 改 column_id
  POST /tasks/{id}/start      member 开始任务（start 列 → doing 列）
  POST /tasks/{id}/submit     提交产出（文字 + 文件）→ review 列
  POST /tasks/{id}/review     审核产出（通过 → done 列 / 打回 → 退回 doing 列，is_rework=true）
  POST /tasks/{id}/tags       给任务加/改 tag

标签（彩色 Label）
  GET  /tags                  标签列表
  POST /tags                  新建标签（名称 + 色板颜色）

清单（Checklist）
  POST   /tasks/{id}/checklists              新建清单
  PUT    /checklists/{cid}                   改名 / 排序
  DELETE /checklists/{cid}                   删除清单
  POST   /checklists/{cid}/items             加清单项
  PUT    /checklist-items/{iid}              勾选/改内容/排序
  DELETE /checklist-items/{iid}              删除清单项

每周必做（admin / super_admin）
  GET    /recurring-tasks       列表
  POST   /recurring-tasks       创建模板（标题/描述/指派人/星期几）
  PUT    /recurring-tasks/{id}  修改 / 停用（is_active）
  DELETE /recurring-tasks/{id}  删除模板

文件
  POST /files/upload          上传，返回附件元信息
  GET  /files/{id}            下载（带权限校验）

通知
  GET  /notifications         我的通知
  POST /notifications/{id}/read

统计
  GET  /stats/overview        任务状态统计
  GET  /stats/members         人员任务统计
```

权限通过 FastAPI 依赖注入做校验（见第 2 节角色定义）。

## 6. 管理面板 & 统计

基于 Task 实时聚合，不建额外表：
- **任务情况统计**：按**当前看板的列**分组数量 + 任务池数 + 逾期数 —— 卡片 + 图表（切换看板时随之变化）
- **人员任务统计**：每 member 名下任务数 / 已完成 / 待审核 / 逾期 —— 表格，点人名筛出其任务
- 任意条目点进去 → 弹出任务详情（Modal）
- 权限：super_admin 看全局，admin 看本部门 + 自己创建/参与的任务

## 6a. 每周必做任务（Recurring）

- admin / super_admin 创建**每周必做模板**：标题、描述、优先级、指派人（一个或多个）、每周生成日（默认周一）。
- **自动生成**：后端定时任务（APScheduler，每天检查）在配置的星期几，为每个指派人各生成一个 Task 实例（`is_mandatory=true`，`recurring_task_id` 指向模板，落「任务看板」`start` 列、`lifecycle=on_board`，**截止固定为本周五 18:00 整**）。
- **必做语义**：任务在被指派人的任务看板/中心醒目标记（如必做徽章），不可被忽略；未在周内完成则标记逾期。
- **不顺延**：上周实例不会延续；下周照常生成新实例。停用模板（`is_active=false`）后停止生成。
- 权限：admin 只能给本部门成员设；super_admin 全局。

## 6b. 任务池（Task Pool）

- **来源**：admin 创建任务时未指派接收人的任务（`lifecycle=open`）。
- **可见范围**：按看板可见性 + 部门隔离，用户只看到自己能看到的看板里、本部门的 open 任务。
- **交互**：**点气泡/列表项 → 弹任务详情**，在详情里按角色操作：
  - **member 申请**：点「申请这个任务」→ 记 `TaskApplication`，任务**仍留池中**，通知本部门 admin；按钮变「已申请」。
  - **admin 分派**：点「分派给我自己」或「分派给成员…」（可从申请人里选）→ 设 `assignee`，任务落到该看板 `start` 列、离开池子。
- **两种视图**：
  - **漂浮视图（默认，"好玩"）**：任务以气泡形式在池中缓慢漂浮（CSS 动画）。气泡大小/亮度按 priority 区分（越紧急越显眼），分派后气泡破裂飞走。
  - **列表视图**：可一键切换为常规列表，便于快速扫读。
- 视图偏好记在前端本地（localStorage）。

## 7. 前端结构 & 视觉（Trello 风看板）

**目标**：看板页（核心）外观与 Trello 面板一致。其余页面沿用同一套配色与组件，但本期重点只做看板。

### 7.1 视觉方向（Trello 暗色模式）

采用 **Trello 暗色模式** 视觉：卡片、列、弹窗均为深色，浮在彩色面板背景上。

- **面板背景**：整页一张彩色渐变背景（默认紫色渐变，调暗以衬深色卡片）。背景铺满主区，列与卡片浮在其上。
- **顶部全局栏**（深色 `#1d2125`）：左侧 应用宫格图标 + Logo「任务系统」，中间 **搜索框**，右侧 **创建** 按钮、通知铃铛、帮助、头像。
- **面板头栏**（背景上方，半透明）：左侧看板标题，右侧 **筛选**、**分享/成员**、**…菜单**；super_admin 还有看板编辑控件（见 §7.2）。
- **列（List）**：深色半透明容器 `#1d2125`（约 95% 不透明）、圆角 12px、细描边；列头显示**列名 + 卡片数**。
- **卡片（Card）**：深色 `#22272b`、圆角 8px、细边框、hover 微亮 + 蓝色描边；紧凑卡面。
- **标签色板**：Trello 风（绿 `#4bce97` / 黄 `#f5cd47` / 橙 `#fea362` / 红 `#f87168` / 紫 `#9f8fef` / 蓝 `#579dff` / 天蓝 / 粉 / 灰）。
- **文字**：系统无衬线，正文浅灰 `#b6c2cf`、标题 `#dee4ea`；徽章用暗底亮字（逾期暗红 / 临近暗黄 / 完成暗绿）。

### 7.2 看板布局（多看板 + 可配置工作流）

- **二级看板切换**：左侧栏「看板」组列出当前用户**可见的看板**（任务看板 / 合同看板 …），点击切换；super_admin 末尾有「+ 新建看板」。
- 主区为**横向滚动的列容器**，列 = 当前看板的 `BoardColumn`。卡片用 **dnd-kit 在列间拖拽 = 改 `column_id`**，列内拖拽 = 排序。
- **super_admin 编辑工作流（仅本人可见控件）**：
  - 点列头名字 → 改列名；列头 `◀ ▶` 调序、`✕` 删列（卡片迁到同看板其他列）；末尾「+ 添加列表」加列。
  - 看板头部：`✏ 看板名`、`👁 可见部门`（弹窗勾选部门，空=全部可见）、`🗑 删除看板`。
- **打回（rework）**：卡片退回 `doing` 列并带红色「重做」徽章（`is_rework`），不单列。
- `open` / `pending_approval` / `declined` 不在看板列里：分别走「任务池页」「审批入口」「已拒绝筛选」。
- **每列底部**（仅 `start` 列、非 super_admin）Trello 风「+ 添加卡片」：行内输入标题快速建卡，建在当前看板的 `start` 列；member 建卡走自提审批。

### 7.3 卡片正面（Card Front，对齐 Trello 徽章）

从上到下：

1. **标签色条**：该卡所有 Tag 的彩色色条（点击可切换显示文字/纯色条）。
2. **标题**。
3. **徽章行**（仅在有内容时显示）：
   - 📅 **截止日期徽章**：临近变黄、逾期变红、已完成变绿。
   - ☑ **清单进度徽章**：`2/5`，全部完成变绿。
   - 🔁 **必做徽章**：必做任务实例醒目标记。
   - ⬆ **优先级**：high 显示醒目角标。
   - 📎 附件数、📝 有描述 等小图标。
4. **右下角成员头像**：assignee 头像（用 full_name 首字母/真名）。

### 7.4 卡片详情（Trello 弹窗 Modal）

点卡片 → 居中大弹窗（背景变暗，URL 同步可分享/刷新保留），布局对齐 Trello：

- **头部**：所属看板 + 当前列（如「合同看板 · 法务复核」）、卡片标题（可改）、所属部门、负责人、彩色标签条。
- **左侧主区**：
  - **描述**（富文本/Markdown 简版）。
  - **清单**：多个 Checklist，各带进度条 + 可勾选项 + 增删项 + 改名。
  - **产出 / 附件**：Deliverable 多轮历史 + Attachment 文件列表（对齐第 3 节验收流程）。
  - **申请人**（仅任务池 open 卡）：列出 member 申请人，admin 可一键「分派给 TA」。
  - **不展示活动流**（按需求去掉，卡片详情不含 TaskActivity 列表）。
- **右侧操作栏**（Trello 风按钮组）：
  - **截止日期**：点开弹出 datetime 选择框（**精确到分钟**，可清除）；**标签**（选色板）、**清单**、**附件**、**成员/指派**（assign / 转派 / 池内分派）、**移动**（改列）。
  - **角色相关动作按钮**（按**列 kind + 角色**显隐）：member 在 start 列见 开始、doing 列见 提交产出、池中卡见 申请；admin 在 review 列见 审核(通过/打回)、对自提任务见 审批、对池中卡见 分派。

### 7.5 其他

- **筛选**（面板头「筛选」弹层，对齐 Trello）：按 **标签 / 负责人 / 截止(逾期·本周) / 关键词** 组合过滤看板卡片。
- **页面清单**：登录、注册（邀请码）、**看板（多二级看板，侧栏切换）**、任务池、待审批、管理面板、每周必做管理、超管（部门/用户管理）、通知。super_admin 还能在看板页内编辑工作流与看板可见性。卡片详情为看板上的 Modal，不再单独走详情页路由（但 Modal 有独立 URL）。
- **技术**：React + Vite + TS，React Router，React Query，Ant Design（自定义 token 贴近 Trello 配色，必要处用原生组件还原 Trello 卡面/列样式），dnd-kit。

## 8. 文件存储 & 通知实现

- **文件**：存本地 `./uploads/{year}/{uuid}-{filename}`，DB 存元信息。下载带权限校验（仅任务相关人）。限制单文件大小（如 50MB）+ 类型白名单。
- **通知**：写库 + 前端轮询（每 30s 拉未读数）。不上 WebSocket，保持简单。

## 9. 测试

- **后端**：pytest，覆盖权限规则（各角色能/不能做什么）、任务列流转（按列 kind：开始/提交/审核/打回）、审批/审核分支、跨部门指派、**任务池申请与分派**、**看板可见性（部门）与工作流编辑（super_admin）**、每周必做的实例生成（多人各生成一份）。测试用 SQLite 内存库。
- **前端**：核心交互冒烟测试（Vitest + Testing Library），重点是状态流转下按钮的显隐逻辑。

## 10. 不做的事（YAGNI）

- 不做多组织/多租户隔离（单团队内部工具）
- 不做邮件/即时推送通知（仅站内 + 轮询）
- 不做对象存储（本地磁盘足够）
- 不做开放注册（必须超管预置 + 邀请码绑定，不能任意自助开户）
- 不做一人多部门
