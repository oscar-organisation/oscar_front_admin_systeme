"""Jetons à usage unique : émission, consommation, garde-fous.

Regroupé ici plutôt que dans les routeurs, pour que l'invitation et la
réinitialisation partagent exactement les mêmes règles de sécurité.

Choix retenus, et pourquoi :

- **Le jeton est tiré de `secrets.token_urlsafe`**, pas d'un UUID. Un UUID v4
  porte 122 bits mais reste un identifiant, pas un secret ; on veut ici 256 bits
  d'entropie issus du générateur cryptographique du système.
- **Seule l'empreinte SHA-256 est stockée.** Pas de hachage lent type argon2 :
  le jeton a déjà une entropie suffisante pour rendre la force brute inutile, et
  la consommation doit rester une lecture indexée.
- **La comparaison passe par l'index sur l'empreinte**, donc pas de comparaison
  d'égalité sur un secret en Python.
- **Émettre un nouveau jeton invalide les précédents du même type.** Sinon un
  lien envoyé trois semaines plus tôt resterait ouvert.
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from .config import settings
from .models import AuthToken, User

INVITE = "invite"
RESET = "reset"


def _empreinte(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def emettre(db: Session, user: User, kind: str, ip: str | None = None) -> str:
    """Crée un jeton, invalide les précédents du même type, retourne le secret.

    Le secret n'est retourné qu'ici : il part dans le courriel et n'est plus
    jamais récupérable ensuite.
    """
    if kind == INVITE:
        duree = timedelta(hours=settings.invite_ttl_hours)
    elif kind == RESET:
        duree = timedelta(minutes=settings.password_reset_ttl_minutes)
    else:
        raise ValueError(f"type de jeton inconnu : {kind!r}")

    maintenant = datetime.now(timezone.utc)

    # Un nouveau lien rend les anciens caducs : on ne laisse pas plusieurs
    # portes ouvertes en parallele sur le meme compte.
    db.execute(
        update(AuthToken)
        .where(
            AuthToken.user_id == user.id,
            AuthToken.kind == kind,
            AuthToken.used_at.is_(None),
        )
        .values(used_at=maintenant)
    )

    secret = secrets.token_urlsafe(32)
    db.add(
        AuthToken(
            user_id=user.id,
            kind=kind,
            token_hash=_empreinte(secret),
            expires_at=maintenant + duree,
            requested_ip=ip,
        )
    )
    db.flush()
    return secret


def consommer(db: Session, token: str, kind: str) -> User | None:
    """Valide et brûle un jeton. Retourne l'utilisateur, ou None.

    Retourne None indistinctement pour un jeton inconnu, expiré, déjà utilisé
    ou d'un autre type : l'appelant ne doit pas pouvoir renvoyer au visiteur
    une raison qui l'aiderait à sonder la base.
    """
    if not token:
        return None

    ligne = db.execute(
        select(AuthToken).where(
            AuthToken.token_hash == _empreinte(token),
            AuthToken.kind == kind,
        )
    ).scalar_one_or_none()

    if ligne is None or ligne.used_at is not None:
        return None

    expire = ligne.expires_at
    if expire.tzinfo is None:
        expire = expire.replace(tzinfo=timezone.utc)
    if expire < datetime.now(timezone.utc):
        return None

    ligne.used_at = datetime.now(timezone.utc)
    return db.get(User, ligne.user_id)


def trop_de_demandes(db: Session, user: User) -> bool:
    """Vrai si le compte a déjà épuisé son quota horaire de réinitialisations.

    Le compteur porte sur le compte visé, pas sur l'appelant : c'est ce qui
    protège une boîte mail d'être inondée depuis plusieurs adresses IP.
    """
    depuis = datetime.now(timezone.utc) - timedelta(hours=1)
    recents = db.execute(
        select(AuthToken).where(
            AuthToken.user_id == user.id,
            AuthToken.kind == RESET,
            AuthToken.created_at >= depuis,
        )
    ).scalars().all()
    return len(recents) >= settings.password_reset_max_per_hour


def lien(chemin: str, token: str) -> str:
    base = settings.public_app_url.rstrip("/")
    return f"{base}{chemin}?token={token}"
