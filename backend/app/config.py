from dataclasses import dataclass
import os
from dotenv import find_dotenv, load_dotenv

load_dotenv(find_dotenv())


def _env(name: str, default: str = "") -> str:
    return (os.getenv(name, default) or "").strip()


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
