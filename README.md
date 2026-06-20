# pp-task-system

面向小团队的**内部任务分配系统**设计文档仓库。

支持登录、部门划分、角色权限（super_admin / admin / member），任务发布与指派、产出验收、每周必做、任务池、统计面板；看板对齐 Trello（多二级看板 + 可配置工作流 + 部门可见性 + 暗色视觉）。

## 文档

- [设计文档](docs/superpowers/specs/2026-06-18-task-system-design.md)

## 技术栈（规划）

- 前端：React + Vite + TypeScript + React Query + Ant Design + dnd-kit
- 后端：FastAPI + SQLAlchemy 2.0 + Alembic + Pydantic + APScheduler
- 数据库：MySQL，认证：JWT
