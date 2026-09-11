"""Validation des access tokens Keycloak (RS256) via JWKS.

Objectifs (Lot 0, additif) :
  - Récupérer le JWKS du realm via la stdlib (urllib) - portable, sans dépendance
    HTTP lourde - avec un cache mémoire par `kid` et un TTL simple.
  - Vérifier la signature RS256, l'émetteur (`iss`), l'audience (`aud` ou `azp`)
    et l'expiration (`exp`) d'un token.
  - Exposer une identité normalisée (sub, email, preferred_username, realm_roles,
    organizations).
  - Fournir une dependency FastAPI `get_kc_identity` (ADDITIVE, ne touche pas
    `deps.get_current_user`).
  - Fournir une fonction testable `verify_access_token(token, jwks_provider)` où
    le `jwks_provider` est injectable, afin de tester sans Keycloak réel (clé
    RS256 de test + tokens forgés).

Ce module n'est PAS branché sur les routes en Lot 0. Il est prêt pour le cutover.
"""
from __future__ import annotations

import json
import threading
import time
import urllib.request
from dataclasses import dataclass, field
from typing import Callable

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import jwt
from jose.exceptions import ExpiredSignatureError, JWTClaimsError, JWTError

from ..config import settings

# Un fournisseur de JWKS renvoie le document JWKS complet : {"keys": [ {jwk}, ... ]}.
JwksProvider = Callable[[], dict]


# --------------------------------------------------------------------------- #
#  Exceptions claires
# --------------------------------------------------------------------------- #
class TokenError(Exception):
    """Erreur générique de validation de token."""


class TokenExpiredError(TokenError):
    """Le token est expiré (exp dépassé)."""


class TokenSignatureError(TokenError):
    """Signature invalide ou clé (kid) introuvable dans le JWKS."""


class TokenAudienceError(TokenError):
    """Audience (aud/azp) ou émetteur (iss) invalide."""


# --------------------------------------------------------------------------- #
#  Identité normalisée renvoyée après validation
# --------------------------------------------------------------------------- #
@dataclass
class KeycloakIdentity:
    """Identité extraite d'un access token Keycloak validé."""

    sub: str
    email: str | None = None
    preferred_username: str | None = None
    realm_roles: list[str] = field(default_factory=list)
    organizations: list[str] = field(default_factory=list)
    raw_claims: dict = field(default_factory=dict)


# --------------------------------------------------------------------------- #
#  Cache JWKS (mémoire, par kid, TTL simple, thread-safe)
# --------------------------------------------------------------------------- #
class JwksCache:
    """Cache mémoire du JWKS d'un realm.

    - Indexe les clés par `kid`.
    - TTL simple : au-delà, on re-fetch au prochain accès.
    - Re-fetch forcé si un `kid` demandé est inconnu (rotation de clés Keycloak).
    """

    def __init__(self, jwks_url: str, ttl_seconds: int = 3600, fetcher: JwksProvider | None = None):
        self._jwks_url = jwks_url
        self._ttl = ttl_seconds
        self._fetcher = fetcher or (lambda: _http_get_json(jwks_url))
        self._keys_by_kid: dict[str, dict] = {}
        self._fetched_at: float = 0.0
        self._lock = threading.Lock()

    def _fetch(self) -> None:
        doc = self._fetcher()
        keys = {k["kid"]: k for k in doc.get("keys", []) if k.get("kid")}
        self._keys_by_kid = keys
        self._fetched_at = time.monotonic()

    def _expired(self) -> bool:
        return (time.monotonic() - self._fetched_at) > self._ttl

    def get_key(self, kid: str) -> dict | None:
        """Renvoie la clé JWK pour un `kid`, en (re)chargeant le JWKS si besoin."""
        with self._lock:
            if not self._keys_by_kid or self._expired():
                self._fetch()
            key = self._keys_by_kid.get(kid)
            if key is None:
                # kid inconnu -> rotation possible : on re-fetch une fois.
                self._fetch()
                key = self._keys_by_kid.get(kid)
            return key

    def as_provider(self) -> JwksProvider:
        """Expose le JWKS complet (utile comme jwks_provider injectable)."""
        def _provider() -> dict:
            with self._lock:
                if not self._keys_by_kid or self._expired():
                    self._fetch()
                return {"keys": list(self._keys_by_kid.values())}
        return _provider


def _http_get_json(url: str, timeout: float = 5.0) -> dict:
    """GET JSON via la stdlib (portable, sans dépendance HTTP externe)."""
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 (URL de config)
        return json.loads(resp.read().decode("utf-8"))


# --------------------------------------------------------------------------- #
#  Extraction des claims custom
# --------------------------------------------------------------------------- #
def _extract_realm_roles(claims: dict) -> list[str]:
    """Rôles realm Keycloak : claim `realm_access.roles`."""
    realm_access = claims.get("realm_access") or {}
    roles = realm_access.get("roles") or []
    return [str(r) for r in roles]


def _extract_organizations(claims: dict) -> list[str]:
    """Tenants (feature Organizations). Le claim `organizations` peut être :
    - une liste de noms/alias : ["carrefour", "dhl"]
    - un objet {alias: {...}} (mapper Keycloak Organizations) -> on prend les clés.
    """
    orgs = claims.get("organizations")
    if orgs is None:
        return []
    if isinstance(orgs, dict):
        return list(orgs.keys())
    if isinstance(orgs, list):
        out: list[str] = []
        for item in orgs:
            if isinstance(item, str):
                out.append(item)
            elif isinstance(item, dict):
                # tolère {"id": "...", "name": "..."} ou {"alias": "..."}
                out.append(str(item.get("alias") or item.get("name") or item.get("id")))
        return [o for o in out if o]
    return []


def _identity_from_claims(claims: dict) -> KeycloakIdentity:
    return KeycloakIdentity(
        sub=str(claims.get("sub", "")),
        email=claims.get("email"),
        preferred_username=claims.get("preferred_username"),
        realm_roles=_extract_realm_roles(claims),
        organizations=_extract_organizations(claims),
        raw_claims=claims,
    )


# --------------------------------------------------------------------------- #
#  Vérification d'un access token (coeur, testable, sans FastAPI)
# --------------------------------------------------------------------------- #
def verify_access_token(
    token: str,
    jwks_provider: JwksProvider,
    *,
    audience: str | None = None,
    issuer: str | None = None,
) -> KeycloakIdentity:
    """Vérifie un access token RS256 et renvoie l'identité normalisée.

    Étapes :
      1. Lecture de l'entête pour trouver le `kid`.
      2. Récupération de la clé publique correspondante dans le JWKS fourni.
      3. Vérification signature + exp + iss (via python-jose).
      4. Vérification audience : `aud` OU `azp` doit valoir `audience`.

    `jwks_provider` est injectable (pour les tests). Il renvoie le document
    JWKS complet {"keys": [...]}.

    Lève : TokenExpiredError, TokenSignatureError, TokenAudienceError.
    """
    aud = audience if audience is not None else settings.oidc_audience
    iss = issuer if issuer is not None else settings.oidc_issuer

    try:
        header = jwt.get_unverified_header(token)
    except JWTError as exc:
        raise TokenSignatureError(f"En-tête JWT illisible : {exc}") from exc

    kid = header.get("kid")
    if not kid:
        raise TokenSignatureError("En-tête JWT sans `kid`.")

    key = _find_key(jwks_provider, kid)
    if key is None:
        raise TokenSignatureError(f"Clé publique introuvable pour kid={kid}.")

    # On vérifie l'audience nous-mêmes (aud OU azp) pour tolérer les tokens
    # Keycloak dont l'audience réelle est portée par `azp`. On demande donc à
    # python-jose de NE PAS vérifier `aud`, mais on vérifie iss + exp + signature.
    try:
        claims = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            issuer=iss,
            options={"verify_aud": False},
        )
    except ExpiredSignatureError as exc:
        raise TokenExpiredError("Token expiré.") from exc
    except JWTClaimsError as exc:
        # iss invalide notamment
        raise TokenAudienceError(f"Claim invalide : {exc}") from exc
    except JWTError as exc:
        raise TokenSignatureError(f"Signature invalide : {exc}") from exc

    if not _audience_ok(claims, aud):
        raise TokenAudienceError(
            f"Audience invalide : attendu `{aud}` dans aud/azp."
        )

    return _identity_from_claims(claims)


def _find_key(jwks_provider: JwksProvider, kid: str) -> dict | None:
    doc = jwks_provider()
    for k in doc.get("keys", []):
        if k.get("kid") == kid:
            return k
    return None


def _audience_ok(claims: dict, expected: str) -> bool:
    aud = claims.get("aud")
    azp = claims.get("azp")
    if isinstance(aud, str):
        aud_list = [aud]
    elif isinstance(aud, (list, tuple)):
        aud_list = list(aud)
    else:
        aud_list = []
    return expected in aud_list or azp == expected


# --------------------------------------------------------------------------- #
#  Cache JWKS partagé (dérivé de la config) + dependency FastAPI
# --------------------------------------------------------------------------- #
_default_cache: JwksCache | None = None
_default_cache_lock = threading.Lock()


def get_default_jwks_cache() -> JwksCache:
    """Cache JWKS partagé, construit à partir de la config (lazy, thread-safe)."""
    global _default_cache
    if _default_cache is None:
        with _default_cache_lock:
            if _default_cache is None:
                _default_cache = JwksCache(settings.oidc_jwks_url_effective)
    return _default_cache


_kc_bearer = HTTPBearer(auto_error=True)


def get_kc_identity(
    creds: HTTPAuthorizationCredentials = Depends(_kc_bearer),
) -> KeycloakIdentity:
    """Dependency FastAPI : valide l'access token Keycloak et renvoie l'identité.

    ADDITIVE : n'altère pas `deps.get_current_user` (auth HS256 maison). Prête
    pour le cutover mais non branchée sur les routes en Lot 0.
    """
    provider = get_default_jwks_cache().as_provider()
    try:
        return verify_access_token(creds.credentials, provider)
    except TokenExpiredError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token expiré")
    except TokenAudienceError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Audience ou émetteur invalide")
    except TokenSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Signature invalide")
    except TokenError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token invalide")
