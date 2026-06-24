from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import (
    admin,
    auth,
    boards,
    checklists,
    export,
    files,
    notifications,
    pool,
    recurring,
    stats,
    tags,
    tasks,
    users,
)
from app.scheduler import start_scheduler, stop_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(title="Task System API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.cors_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(boards.router)
app.include_router(tasks.router)
app.include_router(pool.router)
app.include_router(users.router)
app.include_router(tags.router)
app.include_router(checklists.router)
app.include_router(recurring.router)
app.include_router(files.router)
app.include_router(notifications.router)
app.include_router(stats.router)
app.include_router(export.router)


@app.get("/health")
def health():
    return {"status": "ok"}
