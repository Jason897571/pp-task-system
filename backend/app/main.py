from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import admin, auth, boards, pool, tasks, users

app = FastAPI(title="Task System API")

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


@app.get("/health")
def health():
    return {"status": "ok"}
