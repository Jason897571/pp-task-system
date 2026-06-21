# 部署（Docker Compose）

三个服务：`db`（MySQL 8）、`backend`（FastAPI）、`frontend`（Vite 构建 + Nginx）。
前端 Nginx 同时把 `/api` 反代到后端，所以**只暴露一个 Web 端口**，前后端同源、无需 CORS。

## 一键启动

```bash
cp .env.example .env      # 然后按需修改密码 / JWT_SECRET
docker compose up -d --build
```

打开 `http://localhost:8080`（端口由 `.env` 的 `WEB_PORT` 决定）。

首次启动会自动：
1. 等待 MySQL 就绪
2. 执行 `alembic upgrade head` 建表 / 迁移
3. 若 `RUN_SEED=1`，写入演示账号（幂等，可重复运行）

演示账号（`RUN_SEED=1` 时）：

| 角色 | 用户名 | 密码 |
|------|--------|------|
| 超级管理员 | super | super123 |
| 管理员 | admin | admin123 |
| 成员 | member / member2 | member123 |

## 生产注意事项

- **改密码与密钥**：`.env` 里的 `MYSQL_PASSWORD`、`MYSQL_ROOT_PASSWORD`、`JWT_SECRET` 必须改。
  改 `MYSQL_PASSWORD` 后，`DATABASE_URL` 里的同一密码要做 URL 编码（`!` → `%21`）。
- **关闭演示数据**：生产设 `RUN_SEED=0`，得到干净库。
- **CORS_ORIGIN**：设为用户实际访问的地址（同源时其实用不到，但保持一致更稳妥）。
- **时区**：`TZ`（默认 `Asia/Shanghai`）影响每日/每周六归档定时任务的触发时间。
- **数据持久化**：MySQL 数据在 `db_data` 卷，上传附件在 `uploads` 卷，删除容器不丢数据。

## 常用命令

```bash
docker compose logs -f backend      # 看后端日志
docker compose ps                   # 服务状态
docker compose down                 # 停止（保留数据卷）
docker compose down -v              # 停止并删除数据卷（清空数据库与上传文件）
docker compose exec backend python seed.py   # 手动补种演示数据
```

## 数据备份

```bash
# 备份数据库
docker compose exec db sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" task_system' > backup.sql
# 备份上传文件
docker run --rm -v task-system_uploads:/u -v "$PWD":/b alpine tar czf /b/uploads.tgz -C /u .
```
