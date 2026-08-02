import base64
import hashlib
import hmac
import json
import time
from dataclasses import dataclass

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import auth_token_secret
from app.database.db import get_db
from app.database.models import Clinic


CLINIC_TOKEN_LIFETIME_SECONDS = 8 * 60 * 60
_clinic_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class ClinicPrincipal:
    clinic_id: str
    email: str

def hash_password(password: str) -> str:
    password_bytes = password.encode('utf-8')[:72]
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password_bytes, salt)
    return hashed.decode('utf-8')

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        password_bytes = plain_password.encode('utf-8')[:72]
        hashed_bytes = hashed_password.encode('utf-8')
        return bcrypt.checkpw(password_bytes, hashed_bytes)
    except:
        return False


def _b64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def _clinic_token_signature(payload_part: str, password_hash: str) -> str:
    signing_key = hmac.new(
        auth_token_secret().encode("utf-8"),
        password_hash.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    digest = hmac.new(
        signing_key,
        payload_part.encode("ascii"),
        hashlib.sha256,
    ).digest()
    return _b64url_encode(digest)


def create_clinic_access_token(clinic_id: str, password_hash: str) -> str:
    now = int(time.time())
    payload = {
        "sub": clinic_id,
        "type": "clinic",
        "iat": now,
        "exp": now + CLINIC_TOKEN_LIFETIME_SECONDS,
    }
    payload_part = _b64url_encode(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    )
    signature = _clinic_token_signature(payload_part, password_hash)
    return f"{payload_part}.{signature}"


def _decode_unverified_clinic_token(token: str) -> tuple[str, dict]:
    try:
        payload_part, signature = token.split(".", 1)
        payload = json.loads(_b64url_decode(payload_part))
        if not isinstance(payload, dict):
            raise ValueError("Invalid token payload")
        return signature, {"payload_part": payload_part, **payload}
    except (ValueError, TypeError, json.JSONDecodeError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid clinic session",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def require_clinic_principal(
    credentials: HTTPAuthorizationCredentials | None = Depends(_clinic_bearer),
    db: AsyncSession = Depends(get_db),
) -> ClinicPrincipal:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Clinic login required",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not credentials or credentials.scheme.lower() != "bearer":
        raise unauthorized

    signature, payload = _decode_unverified_clinic_token(credentials.credentials)
    clinic_id = str(payload.get("sub") or "").strip()
    if payload.get("type") != "clinic" or not clinic_id:
        raise unauthorized
    try:
        expires_at = int(payload.get("exp") or 0)
        issued_at = int(payload.get("iat") or 0)
    except (TypeError, ValueError):
        raise unauthorized
    now = int(time.time())
    if expires_at <= now or issued_at > now + 60:
        raise unauthorized

    result = await db.execute(select(Clinic).where(Clinic.clinic_id == clinic_id))
    clinic = result.scalar_one_or_none()
    if not clinic:
        raise unauthorized
    expected = _clinic_token_signature(payload["payload_part"], clinic.password)
    if not hmac.compare_digest(signature, expected):
        raise unauthorized
    return ClinicPrincipal(clinic_id=clinic.clinic_id, email=clinic.email)


def require_matching_clinic(principal: ClinicPrincipal, requested_clinic_id: str) -> str:
    if principal.clinic_id != (requested_clinic_id or "").strip():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This clinic session cannot access another clinic's EHR data",
        )
    return principal.clinic_id
