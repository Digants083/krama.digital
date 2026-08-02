from dataclasses import dataclass
import hashlib
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


def _env_int(name: str, default: int, minimum: int = 1, maximum: int | None = None) -> int:
    raw_value = _env(name)
    if not raw_value:
        return default
    try:
        value = max(minimum, int(raw_value))
        return min(maximum, value) if maximum is not None else value
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


def auth_token_secret() -> str:
    """Return one stable signing secret across reloads and server workers."""
    configured = _env("JWT_SECRET")
    if configured:
        return configured
    database = _env("DATABASE_URL")
    if not database:
        raise RuntimeError("JWT_SECRET or DATABASE_URL must be configured for secure sessions.")
    return hashlib.sha256(f"krama-auth-token:{database}".encode("utf-8")).hexdigest()


def admin_data_password_hash() -> str:
    """Server-only bcrypt hash for unlocking the sensitive admin data area."""
    return _env(
        "ADMIN_DATA_PASSWORD_HASH",
        "$2b$12$WGdF6YCdI/thpQDhjy7TCOQRnI7ho904Jpk9NX.b6lRvPuGiRumUW",
    )


def background_jobs_enabled() -> bool:
    return _env_bool("BACKGROUND_JOBS_ENABLED", True)


def cors_allowed_origins() -> list[str]:
    configured = _env("CORS_ALLOWED_ORIGINS")
    if configured:
        return [origin.strip().rstrip("/") for origin in configured.split(",") if origin.strip()]
    return [
        "https://krama.digital",
        "https://www.krama.digital",
        "http://localhost:8080",
        "http://localhost:8081",
        "http://127.0.0.1:8080",
        "http://127.0.0.1:8081",
    ]


def scheduler_active_poll_seconds() -> int:
    return _env_int("SCHEDULER_ACTIVE_POLL_SECONDS", 60, minimum=30)


def scheduler_idle_poll_seconds() -> int:
    return _env_int("SCHEDULER_IDLE_POLL_SECONDS", 300, minimum=60)


def ollama_base_url() -> str:
    return _env("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")


def ehr_model_name() -> str:
    return _env("OLLAMA_MODEL", _env("EHR_MODEL", "gpt-oss:20b"))


def gpu_instance_id() -> str:
    return _env("GPU_INSTANCE_ID")


def aws_region() -> str:
    return _env("AWS_REGION", "ap-south-1")


def gpu_idle_timeout_seconds() -> int:
    return _env_int("GPU_IDLE_TIMEOUT", 1200, minimum=60)


def gpu_startup_timeout_seconds() -> int:
    return _env_int("GPU_STARTUP_TIMEOUT", 900, minimum=60)


def gpu_readiness_poll_seconds() -> int:
    return _env_int("GPU_READINESS_POLL_SECONDS", 5, minimum=1)


def ehr_generation_timeout_seconds() -> int:
    return _env_int("EHR_GENERATION_TIMEOUT_SECONDS", 900, minimum=60)


def ehr_queue_estimated_minutes_per_job() -> int:
    return _env_int("EHR_QUEUE_ESTIMATED_MINUTES_PER_JOB", 5, minimum=1)


def ehr_generation_concurrency() -> int:
    # Two simultaneous 32K-context generations are the safe default for a
    # dedicated 24 GB GPU. Raise only after measuring real peak VRAM usage.
    return _env_int("EHR_GENERATION_CONCURRENCY", 2, minimum=1, maximum=8)


def ehr_queue_poll_seconds() -> int:
    return _env_int("EHR_QUEUE_POLL_SECONDS", 2, minimum=1)


def ehr_context_window_tokens() -> int:
    # num_ctx is the combined prompt + response window. SOAP prompts include
    # the transcript, schema, and retrieved documentation rules, so 8K is too
    # small for ordinary multi-minute consultations.
    return _env_int("EHR_CONTEXT_WINDOW_TOKENS", 32768, minimum=16384)


def ehr_initial_output_tokens() -> int:
    return _env_int("EHR_INITIAL_OUTPUT_TOKENS", 3072, minimum=2048)


def ehr_max_output_tokens() -> int:
    return _env_int("EHR_MAX_OUTPUT_TOKENS", 6144, minimum=4096)
