"""Tests du module de validation JWKS Keycloak (app/auth/keycloak.py).

Portables : AUCUN conteneur Keycloak requis. On genere une paire de cles RS256
de test, on construit un JWKS injectable, on forge des tokens (valide, expire,
mauvaise audience, mauvaise signature) et on verifie le comportement de
`verify_access_token`.
"""
import time

import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from jose import jwk, jwt
from jose.constants import ALGORITHMS

from app.auth.keycloak import (
    JwksCache,
    TokenAudienceError,
    TokenExpiredError,
    TokenSignatureError,
    verify_access_token,
)

ISSUER = "http://localhost:8080/realms/oscar"
AUDIENCE = "oscar-backend"
KID = "test-key-1"
OTHER_KID = "test-key-2"


def _new_rsa_pem() -> tuple[str, str]:
    """Genere une paire RSA de test et renvoie (private_pem, public_pem)."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    from cryptography.hazmat.primitives import serialization

    priv = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()
    pub = key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()
    return priv, pub


def _jwk_from_public_pem(public_pem: str, kid: str) -> dict:
    """Construit un JWK public (RS256) a partir d'un PEM public, avec kid."""
    k = jwk.construct(public_pem, algorithm=ALGORITHMS.RS256).to_dict()
    # jose renvoie parfois des bytes pour n/e : normalise en str pour le JSON.
    for field in ("n", "e"):
        if isinstance(k.get(field), bytes):
            k[field] = k[field].decode()
    k["kid"] = kid
    k["use"] = "sig"
    k["alg"] = "RS256"
    return k


@pytest.fixture(scope="module")
def keypair():
    priv, pub = _new_rsa_pem()
    return priv, pub


@pytest.fixture(scope="module")
def other_keypair():
    priv, pub = _new_rsa_pem()
    return priv, pub


@pytest.fixture(scope="module")
def jwks_provider(keypair):
    """Fournit un JWKS de test contenant la cle publique legitime (KID)."""
    _, pub = keypair
    doc = {"keys": [_jwk_from_public_pem(pub, KID)]}
    return lambda: doc


def _make_token(private_pem: str, *, kid: str = KID, aud=AUDIENCE, azp=None,
                iss: str = ISSUER, exp_offset: int = 3600, extra: dict | None = None) -> str:
    now = int(time.time())
    claims = {
        "sub": "user-123",
        "email": "operator@oscar.fr",
        "preferred_username": "operator",
        "iss": iss,
        "iat": now,
        "exp": now + exp_offset,
        "realm_access": {"roles": ["SITE_OPERATOR", "robot.operate"]},
        "organizations": {"carrefour": {"id": "org-1"}, "dhl": {"id": "org-2"}},
    }
    if aud is not None:
        claims["aud"] = aud
    if azp is not None:
        claims["azp"] = azp
    if extra:
        claims.update(extra)
    headers = {"kid": kid}
    return jwt.encode(claims, private_pem, algorithm="RS256", headers=headers)


# --------------------------------------------------------------------------- #
#  Cas nominal
# --------------------------------------------------------------------------- #
def test_valid_token_accepted(keypair, jwks_provider):
    priv, _ = keypair
    token = _make_token(priv)
    ident = verify_access_token(token, jwks_provider, audience=AUDIENCE, issuer=ISSUER)
    assert ident.sub == "user-123"
    assert ident.email == "operator@oscar.fr"
    assert ident.preferred_username == "operator"
    assert "SITE_OPERATOR" in ident.realm_roles
    assert set(ident.organizations) == {"carrefour", "dhl"}


def test_valid_token_audience_via_azp(keypair, jwks_provider):
    """Un token dont l'audience est portee par `azp` (et pas `aud`) est accepte."""
    priv, _ = keypair
    token = _make_token(priv, aud=None, azp=AUDIENCE)
    ident = verify_access_token(token, jwks_provider, audience=AUDIENCE, issuer=ISSUER)
    assert ident.sub == "user-123"


def test_organizations_list_form(keypair, jwks_provider):
    """Le claim organizations sous forme de liste de chaines est supporte."""
    priv, _ = keypair
    token = _make_token(priv, extra={"organizations": ["carrefour", "dhl"]})
    ident = verify_access_token(token, jwks_provider, audience=AUDIENCE, issuer=ISSUER)
    assert set(ident.organizations) == {"carrefour", "dhl"}


# --------------------------------------------------------------------------- #
#  Cas de rejet
# --------------------------------------------------------------------------- #
def test_expired_token_rejected(keypair, jwks_provider):
    priv, _ = keypair
    token = _make_token(priv, exp_offset=-10)  # deja expire
    with pytest.raises(TokenExpiredError):
        verify_access_token(token, jwks_provider, audience=AUDIENCE, issuer=ISSUER)


def test_wrong_audience_rejected(keypair, jwks_provider):
    priv, _ = keypair
    token = _make_token(priv, aud="autre-client", azp="autre-client")
    with pytest.raises(TokenAudienceError):
        verify_access_token(token, jwks_provider, audience=AUDIENCE, issuer=ISSUER)


def test_wrong_issuer_rejected(keypair, jwks_provider):
    priv, _ = keypair
    token = _make_token(priv, iss="http://evil/realms/oscar")
    with pytest.raises(TokenAudienceError):
        verify_access_token(token, jwks_provider, audience=AUDIENCE, issuer=ISSUER)


def test_bad_signature_rejected(other_keypair, jwks_provider):
    """Token signe par une AUTRE cle mais annonçant le KID legitime -> rejet."""
    other_priv, _ = other_keypair
    token = _make_token(other_priv, kid=KID)
    with pytest.raises(TokenSignatureError):
        verify_access_token(token, jwks_provider, audience=AUDIENCE, issuer=ISSUER)


def test_unknown_kid_rejected(keypair, jwks_provider):
    priv, _ = keypair
    token = _make_token(priv, kid=OTHER_KID)  # kid absent du JWKS
    with pytest.raises(TokenSignatureError):
        verify_access_token(token, jwks_provider, audience=AUDIENCE, issuer=ISSUER)


# --------------------------------------------------------------------------- #
#  Cache JWKS : re-fetch sur kid inconnu + TTL
# --------------------------------------------------------------------------- #
def test_jwks_cache_refetches_on_unknown_kid(keypair):
    """Le cache re-fetch quand un kid inconnu est demande (rotation de cles)."""
    _, pub = keypair
    calls = {"n": 0}

    def fetcher():
        calls["n"] += 1
        # 1er appel : JWKS vide ; ensuite : contient la cle legitime.
        if calls["n"] == 1:
            return {"keys": []}
        return {"keys": [_jwk_from_public_pem(pub, KID)]}

    cache = JwksCache("http://unused", ttl_seconds=3600, fetcher=fetcher)
    # 1er get : kid absent -> declenche un 2e fetch qui le trouve.
    key = cache.get_key(KID)
    assert key is not None
    assert calls["n"] == 2


def test_jwks_cache_provider_roundtrip(keypair):
    """Le provider expose par le cache permet de valider un token reel."""
    priv, pub = keypair

    def fetcher():
        return {"keys": [_jwk_from_public_pem(pub, KID)]}

    cache = JwksCache("http://unused", ttl_seconds=3600, fetcher=fetcher)
    token = _make_token(priv)
    ident = verify_access_token(token, cache.as_provider(), audience=AUDIENCE, issuer=ISSUER)
    assert ident.sub == "user-123"
