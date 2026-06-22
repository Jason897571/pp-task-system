# pp-task-system

面向小团队的**内部任务分配系统**：登录、部门划分、角色权限（super_admin / admin / member），
任务发布与指派、产出提交与审核、每周必做、任务池、统计面板；看板对齐 Trello
（多看板 + 可配置工作流 + 部门/成员可见性 + 暗色视觉），并支持归档看板与卡片回收箱。

## 技术栈

- **前端**：React + Vite + TypeScript + React Query + Ant Design + dnd-kit
- **后端**：FastAPI + SQLAlchemy 2.0 + Alembic + Pydantic + APScheduler
- **数据库**：MySQL 8　**认证**：JWT

---

## 快速启动

### 方式一：Docker Compose（推荐，一条命令）

需要已安装 Docker。三个服务（MySQL + 后端 + 前端 Nginx）一起拉起，前端 Nginx 同时反代
`/api` 到后端，只暴露一个 Web 端口。

```bash
cp .env.example .env          # 按需改密码 / JWT_SECRET / WEB_PORT
docker compose up -d --build
```

打开 **http://localhost:8080**（端口由 `.env` 的 `WEB_PORT` 决定）。

首次启动会自动建表、迁移；若 `.env` 里 `RUN_SEED=1` 则写入演示账号（见下表）。
生产环境请设 `RUN_SEED=0` 得到干净库。更多部署细节（备份、生产注意事项）见 **[DEPLOY.md](DEPLOY.md)**。

### 方式二：本地开发（前后端分别启动）

前置：本机有一个可用的 MySQL，并创建好 `task_system` 与 `task_system_test` 两个库
（或在 `backend/.env` 里把 `DATABASE_URL` 改成你自己的连接串）。

**后端**（端口 8000）：

```bash
cd backend
uv venv --python 3.11 .venv
source .venv/bin/activate
uv pip install -r requirements.txt
cp .env.example .env           # 按需调整 DATABASE_URL / JWT_SECRET
alembic upgrade head           # 建表 / 迁移
python seed.py                 # 写入演示账号（幂等）
uvicorn app.main:app --port 8000 --reload
```

**前端**（端口 5173，Vite dev server 会把 `/api` 代理到 `localhost:8000`）：

```bash
cd frontend
npm install
npm run dev
```

打开 **http://localhost:5173**。

---

## 演示账号（`RUN_SEED=1` / 跑过 `seed.py` 时）

| 角色 | 用户名 | 密码 |
|------|--------|------|
| 超级管理员 | `super` | `super123` |
| 管理员 | `admin` | `admin123` |
| 成员 | `member` / `member2` | `member123` |

> 成员账号通过**邀请码**注册激活：管理员在「管理 → 用户」预置用户后会生成一次性邀请码，
> 该码也会显示在用户列表的「邀请码」列（可点复制）。

---

## 测试

```bash
# 后端（使用 TEST_DATABASE_URL 指向的库，按 session 建表/清表）
cd backend && source .venv/bin/activate && python -m pytest -q

# 前端
cd frontend && npm run test
```

---

## 主要功能

- **看板与工作流**：super 可建多看板、自选 emoji 图标、增删列、拖拽排序；任意列可标记为
  「审核节点」（每板至多一个），标记后成员提交需管理员审核通过才能进入完成列。
- **任务流转**：任务池领取 → 指派 → 开始 → 提交产出 → 审核通过/打回。
- **归档看板**：super 把某列设为「最终验收完成」，其卡片视为完成，每周六自动归档到全局归档看板。
- **回收箱**：管理员可删除卡片，进入回收箱保留 30 天，可恢复或彻底删除，到期自动清理。
- **其他**：每周必做（定时生成）、统计面板、部门/成员看板可见性、卡片清单与附件、通知。

## 文档

- [设计文档](docs/superpowers/specs/2026-06-18-task-system-design.md)
- [部署说明（DEPLOY.md）](DEPLOY.md)
- [接口契约](docs/API_CONTRACT.md)
