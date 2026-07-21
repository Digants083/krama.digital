from dataclasses import dataclass
import os
from dotenv import find_dotenv, load_dotenv

load_dotenv(find_dotenv())


def _env(name: str, default: str = "") -> str:
    return (os.getenv(name, default) or "").strip()


def _env_bool(name: str, default: bool) -> bool:
    raw_value = _env(name)
    if not raw_value:
        return default
    return raw_value.lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int, minimum: int = 1) -> int:
    raw_value = _env(name)
    if not raw_value:
        return default
    try:
        return max(minimum, int(raw_value))
    except ValueError:
        return default


def database_url() -> str:
    raw_url = _env("DATABASE_URL")
    if not raw_url:
        raise RuntimeError(
            "DATABASE_URL is not configured. Set it to a PostgreSQL URL, for example "
            "postgresql+asyncpg://user:password@localhost:5432/database."
        )

    if raw_url.startswith("postgresql://"):
        return raw_url.replace("postgresql://", "postgresql+asyncpg://", 1)

    if raw_url.startswith("postgres://"):
        return raw_url.replace("postgres://", "postgresql+asyncpg://", 1)

    if not raw_url.startswith("postgresql+asyncpg://"):
        raise RuntimeError("DATABASE_URL must use the asyncpg driver: postgresql+asyncpg://...")

    return raw_url


@dataclass(frozen=True)
class AdminSeed:
    username: str
    email: str
    confirmation_email: str


def admin_seeds() -> list[AdminSeed]:
    return [
        AdminSeed(
            username="admin1",
            email=_env("ADMIN1_EMAIL", "diganths083@gmail.com"),
            confirmation_email=_env("ADMIN1_CONFIRMATION_EMAIL", "digitalkrama@gmail.com"),
        ),
    ]


def admin_usernames() -> set[str]:
    return {admin.username for admin in admin_seeds() if admin.email and admin.confirmation_email}


def background_jobs_enabled() -> bool:
    return _env_bool("BACKGROUND_JOBS_ENABLED", True)


def scheduler_active_poll_seconds() -> int:
    return _env_int("SCHEDULER_ACTIVE_POLL_SECONDS", 60, minimum=30)


def scheduler_idle_poll_seconds() -> int:
    return _env_int("SCHEDULER_IDLE_POLL_SECONDS", 300, minimum=60)


def ollama_base_url() -> str:
    return _env("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")


def ehr_model_name() -> str:
    return _env("EHR_MODEL", "gpt-oss:20b")


def ehr_generation_timeout_seconds() -> int:
    return _env_int("EHR_GENERATION_TIMEOUT_SECONDS", 600, minimum=60)
