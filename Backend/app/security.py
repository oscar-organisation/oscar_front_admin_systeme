"""JWT d'authentification + génération des jetons LiveKit (robot / opérateur)."""
import time
import uuid
from datetime import datetime, timedelta, timezone

from jose import jwt
from passlib.context import CryptContext

from .config import settings

ALGO = "HS256"
_pwd = CryptContext(schemes=["argon2"], deprecated="auto")


# ---- mots de passe ---------------------------------------------------------
def hash_password(raw: str) -> str:
    return _pwd.hash(raw)


def verify_password(raw: str, hashed: str) -> bool:
    return _pwd.verify(raw, hashed)


# ---- JWT d'auth de la console ---------------------------------------------
def create_access_token(subject: str, kind: str = "access") -> str:
    now = datetime.now(timezone.utc)
    ttl = (
        timedelta(minutes=settings.access_ttl_minutes)
        if kind == "access"
        else timedelta(days=settings.refresh_ttl_days)
    )
    payload = {"sub": subject, "type": kind, "iat": now, "exp": now + ttl}
    return jwt.encode(payload, settings.secret_key, algorithm=ALGO)


def decode_token(token: str) -> dict:
    return jwt.decode(token, settings.secret_key, algorithms=[ALGO])


# ---- Jetons LiveKit --------------------------------------------------------
def create_livekit_token(
    identity: str,
    room: str,
    *,
    can_publish: bool,
    can_subscribe: bool = True,
    can_publish_data: bool = True,
    ttl_hours: int = 4,
    name: str | None = None,
) -> str:
    """Jeton compatible LiveKit (claim `video`), signé avec la clé API partagée."""
    now = int(time.time())
    grant = {
        "room": room,
        "roomJoin": True,
        "canPublish": can_publish,
        "canSubscribe": can_subscribe,
        "canPublishData": can_publish_data,
    }
    payload = {
        "iss": settings.livekit_api_key,
        "sub": identity,
        "name": name or identity,
        "nbf": now,
        "iat": now,
        "exp": now + ttl_hours * 3600,
        "jti": uuid.uuid4().hex,
        "video": grant,
    }
    return jwt.encode(payload, settings.livekit_api_secret, algorithm=ALGO)


def create_livekit_server_token(room: str, ttl_seconds: int = 120) -> str:
    """Jeton d'administration LiveKit (RoomService) : introspection d'une room."""
    now = int(time.time())
    payload = {
        "iss": settings.livekit_api_key,
        "sub": "admin-console",
        "nbf": now,
        "iat": now,
        "exp": now + ttl_seconds,
        "video": {"roomAdmin": True, "roomList": True, "room": room},
    }
    return jwt.encode(payload, settings.livekit_api_secret, algorithm=ALGO)
