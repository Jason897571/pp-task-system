import os

from dotenv import load_dotenv

load_dotenv()

DEFAULT_DB_URL = "mysql+pymysql://task_app:Task_App_2026%21@localhost/task_system"
DEFAULT_TEST_DB_URL = "mysql+pymysql://task_app:Task_App_2026%21@localhost/task_system_test"


class Settings:
    database_url: str = os.getenv("DATABASE_URL", DEFAULT_DB_URL)
    test_database_url: str = os.getenv("TEST_DATABASE_URL", DEFAULT_TEST_DB_URL)
    jwt_secret: str = os.getenv("JWT_SECRET", "dev-secret-change-me")
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = int(os.getenv("JWT_EXPIRE_MINUTES", "720"))
    cors_origin: str = os.getenv("CORS_ORIGIN", "http://localhost:5173")


settings = Settings()
