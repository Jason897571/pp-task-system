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

    # Feishu (Lark) bitable sync — defaults target the project's 任务总表.
    feishu_app_id: str = os.getenv("FEISHU_APP_ID", "cli_a92c47b3a038dbb6")
    feishu_app_secret: str = os.getenv(
        "FEISHU_APP_SECRET", "dMefpqcnz3w69PIcJ3ukiicU20g8b0D4"
    )
    feishu_wiki_node: str = os.getenv("FEISHU_WIKI_NODE", "LY8TwYpKXitji9ktIHLchVtQnXf")
    feishu_table_id: str = os.getenv("FEISHU_TABLE_ID", "tbloCw7dhGA7MKTB")


settings = Settings()
