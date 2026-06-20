import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.database import Base, get_db
from app.main import app

# Use the MySQL test database (task_system_test). Tables are created/dropped
# per session.
test_engine = create_engine(settings.test_database_url, pool_pre_ping=True, future=True)
TestSession = sessionmaker(
    bind=test_engine, autoflush=False, expire_on_commit=False, future=True
)


@pytest.fixture(scope="session", autouse=True)
def _schema():
    Base.metadata.drop_all(test_engine)
    Base.metadata.create_all(test_engine)
    yield
    Base.metadata.drop_all(test_engine)


@pytest.fixture
def db():
    session = TestSession()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(db):
    def _override():
        yield db

    app.dependency_overrides[get_db] = _override
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def _clean(db):
    """Wipe rows between tests for isolation (FK-safe order)."""
    yield
    for table in reversed(Base.metadata.sorted_tables):
        db.execute(table.delete())
    db.commit()


# ---- helpers shared across tests ----


def auth_header(client, username: str, password: str) -> dict:
    resp = client.post("/api/auth/login", json={"username": username, "password": password})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}
