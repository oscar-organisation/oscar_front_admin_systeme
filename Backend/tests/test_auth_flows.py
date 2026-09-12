"""Parcours d'invitation, d'oubli de mot de passe et de compte personnel.

Ces tests portent sur les seules routes de l'API ouvertes sans authentification.
Ils vérifient autant le chemin nominal que les refus : c'est là que se jouent
l'énumération d'adresses, le rejeu de lien et le verrouillage d'un compte depuis
un poste laissé ouvert.
"""

import uuid

import pytest

from app import auth_tokens, mailer
from app.database import SessionLocal
from app.models import AuthToken, User

MDP_LONG = "un-mot-de-passe-assez-long"
MDP_AUTRE = "un-autre-mot-de-passe-long"


@pytest.fixture()
def courriels(monkeypatch):
    """Intercepte les envois : aucun SMTP n'est sollicité pendant les tests."""
    boite = []
    monkeypatch.setattr(mailer, "envoyer", lambda c, d: boite.append((d, c.sujet)) or True)
    return boite


@pytest.fixture()
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def _cree_invite(client, admin_headers, email, nom="Invite Test"):
    r = client.post("/api/users", headers=admin_headers,
                    json={"email": email, "nom": nom, "statut": "invited"})
    assert r.status_code == 201, r.text
    return r.json()


# --------------------------------------------------------------------------- #
#  Invitation
# --------------------------------------------------------------------------- #

def test_creation_sans_mot_de_passe_envoie_une_invitation(client, admin_headers, courriels, db):
    _cree_invite(client, admin_headers, "invite1@exemple.fr")
    assert any(d == "invite1@exemple.fr" for d, _ in courriels)


def test_seule_lempreinte_du_jeton_est_stockee(client, admin_headers, courriels, db):
    _cree_invite(client, admin_headers, "invite2@exemple.fr")
    user = db.query(User).filter(User.email == "invite2@exemple.fr").one()
    jeton = db.query(AuthToken).filter(
        AuthToken.user_id == user.id, AuthToken.kind == "invite"
    ).one()
    assert len(jeton.token_hash) == 64
    assert all(c in "0123456789abcdef" for c in jeton.token_hash)


def test_verification_du_lien_ne_le_consomme_pas(client, admin_headers, courriels, db):
    _cree_invite(client, admin_headers, "invite3@exemple.fr")
    user = db.query(User).filter(User.email == "invite3@exemple.fr").one()
    secret = auth_tokens.emettre(db, user, auth_tokens.INVITE)
    db.commit()

    for _ in range(2):
        r = client.get(f"/api/auth/invitation/{secret}")
        assert r.status_code == 200
        assert r.json()["valide"] is True

    r = client.post("/api/auth/accept-invitation", json={"token": secret, "password": MDP_LONG})
    assert r.status_code == 204


def test_lien_inconnu_repond_invalide_sans_detail(client):
    r = client.get("/api/auth/invitation/jeton-qui-n-existe-pas")
    assert r.status_code == 200
    corps = r.json()
    assert corps["valide"] is False
    assert corps["email"] is None and corps["nom"] is None


def test_activation_puis_rejeu_refuse(client, admin_headers, courriels, db):
    _cree_invite(client, admin_headers, "invite4@exemple.fr")
    user = db.query(User).filter(User.email == "invite4@exemple.fr").one()
    secret = auth_tokens.emettre(db, user, auth_tokens.INVITE)
    db.commit()

    assert client.post("/api/auth/accept-invitation",
                       json={"token": secret, "password": MDP_LONG}).status_code == 204
    # Le meme lien rejoue doit echouer, meme avec un mot de passe different.
    assert client.post("/api/auth/accept-invitation",
                       json={"token": secret, "password": MDP_AUTRE}).status_code == 400

    r = client.post("/api/auth/login", json={"email": "invite4@exemple.fr", "password": MDP_LONG})
    assert r.status_code == 200


def test_mot_de_passe_trop_court_refuse(client, admin_headers, courriels, db):
    _cree_invite(client, admin_headers, "invite5@exemple.fr")
    user = db.query(User).filter(User.email == "invite5@exemple.fr").one()
    secret = auth_tokens.emettre(db, user, auth_tokens.INVITE)
    db.commit()
    r = client.post("/api/auth/accept-invitation", json={"token": secret, "password": "court"})
    assert r.status_code == 422


def test_nouvelle_invitation_invalide_la_precedente(client, admin_headers, courriels, db):
    _cree_invite(client, admin_headers, "invite6@exemple.fr")
    user = db.query(User).filter(User.email == "invite6@exemple.fr").one()
    premier = auth_tokens.emettre(db, user, auth_tokens.INVITE)
    db.commit()
    second = auth_tokens.emettre(db, user, auth_tokens.INVITE)
    db.commit()

    assert client.get(f"/api/auth/invitation/{premier}").json()["valide"] is False
    assert client.get(f"/api/auth/invitation/{second}").json()["valide"] is True


# --------------------------------------------------------------------------- #
#  Mot de passe oublié
# --------------------------------------------------------------------------- #

def test_compte_inconnu_repond_204_et_nenvoie_rien(client, courriels):
    avant = len(courriels)
    r = client.post("/api/auth/forgot-password", json={"email": "personne@nulle-part.fr"})
    assert r.status_code == 204
    assert len(courriels) == avant, "un courriel partant trahirait l'existence du compte"


def test_compte_connu_recoit_un_lien(client, admin_headers, courriels, db):
    _cree_invite(client, admin_headers, "oubli1@exemple.fr")
    avant = len(courriels)
    r = client.post("/api/auth/forgot-password", json={"email": "oubli1@exemple.fr"})
    assert r.status_code == 204
    assert len(courriels) > avant


def test_reinitialisation_puis_connexion(client, admin_headers, courriels, db):
    _cree_invite(client, admin_headers, "oubli2@exemple.fr")
    user = db.query(User).filter(User.email == "oubli2@exemple.fr").one()
    secret = auth_tokens.emettre(db, user, auth_tokens.RESET)
    db.commit()

    assert client.post("/api/auth/reset-password",
                       json={"token": secret, "password": MDP_LONG}).status_code == 204
    r = client.post("/api/auth/login", json={"email": "oubli2@exemple.fr", "password": MDP_LONG})
    assert r.status_code == 200


def test_jeton_dinvitation_refuse_sur_la_reinitialisation(client, admin_headers, courriels, db):
    """Les deux types ne sont pas interchangeables, malgré un stockage commun."""
    _cree_invite(client, admin_headers, "oubli3@exemple.fr")
    user = db.query(User).filter(User.email == "oubli3@exemple.fr").one()
    secret = auth_tokens.emettre(db, user, auth_tokens.INVITE)
    db.commit()
    r = client.post("/api/auth/reset-password", json={"token": secret, "password": MDP_LONG})
    assert r.status_code == 400


def test_quota_horaire_de_reinitialisation(client, admin_headers, courriels, db):
    _cree_invite(client, admin_headers, "oubli4@exemple.fr")
    user = db.query(User).filter(User.email == "oubli4@exemple.fr").one()
    assert auth_tokens.trop_de_demandes(db, user) is False
    for _ in range(6):
        auth_tokens.emettre(db, user, auth_tokens.RESET)
    db.commit()
    assert auth_tokens.trop_de_demandes(db, user) is True


# --------------------------------------------------------------------------- #
#  Compte personnel
# --------------------------------------------------------------------------- #

@pytest.fixture()
def compte_actif(client, admin_headers, courriels, db):
    # Adresse unique par test : la base est partagee sur toute la session pytest,
    # et une adresse figee ferait echouer le second appel sur un conflit 409.
    email = f"compte-{uuid.uuid4().hex[:8]}@exemple.fr"
    _cree_invite(client, admin_headers, email, nom="Compte Test")
    user = db.query(User).filter(User.email == email).one()
    secret = auth_tokens.emettre(db, user, auth_tokens.INVITE)
    db.commit()
    client.post("/api/auth/accept-invitation", json={"token": secret, "password": MDP_LONG})
    r = client.post("/api/auth/login", json={"email": email, "password": MDP_LONG})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['access_token']}", "X-Test-Email": email}


def test_modification_du_profil(client, compte_actif):
    r = client.patch("/api/auth/me/profile", headers=compte_actif, json={"nom": "Nom Corrige"})
    assert r.status_code == 200
    assert client.get("/api/auth/me", headers=compte_actif).json()["nom"] == "Nom Corrige"


def test_adresse_deja_prise_refusee(client, compte_actif):
    r = client.patch("/api/auth/me/profile", headers=compte_actif,
                     json={"email": "admin@oscar.fr"})
    assert r.status_code == 409


def test_changement_exige_le_mot_de_passe_actuel(client, compte_actif, courriels):
    r = client.post("/api/auth/me/password", headers=compte_actif,
                    json={"current_password": "pas-le-bon", "new_password": MDP_AUTRE})
    assert r.status_code == 400, "une session ouverte ne doit pas suffire a changer le secret"


def test_nouveau_mot_de_passe_doit_differer(client, compte_actif, courriels):
    r = client.post("/api/auth/me/password", headers=compte_actif,
                    json={"current_password": MDP_LONG, "new_password": MDP_LONG})
    assert r.status_code == 422


def test_changement_de_mot_de_passe_et_notification(client, compte_actif, courriels):
    avant = len(courriels)
    r = client.post("/api/auth/me/password", headers=compte_actif,
                    json={"current_password": MDP_LONG, "new_password": MDP_AUTRE})
    assert r.status_code == 204
    assert len(courriels) > avant, "l'utilisateur doit etre prevenu du changement"
    assert client.post("/api/auth/login",
                       json={"email": compte_actif["X-Test-Email"],
                             "password": MDP_AUTRE}).status_code == 200


# --------------------------------------------------------------------------- #
#  Politique de mot de passe et garde-fou de configuration
# --------------------------------------------------------------------------- #

def test_politique_exposee_et_appliquee(client, admin_headers, courriels, db):
    """L'API annonce la meme longueur que celle qu'elle impose."""
    from app.config import settings

    annoncee = client.get("/api/auth/password-policy").json()["min_length"]
    assert annoncee == settings.password_min_length

    _cree_invite(client, admin_headers, "politique@exemple.fr")
    user = db.query(User).filter(User.email == "politique@exemple.fr").one()
    secret = auth_tokens.emettre(db, user, auth_tokens.INVITE)
    db.commit()

    trop_court = "a" * (annoncee - 1)
    assert client.post("/api/auth/accept-invitation",
                       json={"token": secret, "password": trop_court}).status_code == 422

    pile = "a" * annoncee
    assert client.post("/api/auth/accept-invitation",
                       json={"token": secret, "password": pile}).status_code == 204


def test_smtp_actif_et_url_de_developpement_refusent_le_demarrage(monkeypatch):
    """Un lien vers localhost dans une invitation doit bloquer, pas passer."""
    from app import main
    from app.config import settings

    monkeypatch.setattr(settings, "smtp_host", "ssl0.ovh.net")
    monkeypatch.setattr(settings, "smtp_user", "no-reply@exemple.fr")
    monkeypatch.setattr(settings, "public_app_url", "http://localhost:5173")
    with pytest.raises(RuntimeError, match="PUBLIC_APP_URL"):
        main._verifier_configuration_courriel()

    # Domaine reel : rien ne bloque.
    monkeypatch.setattr(settings, "public_app_url", "https://admin-console.oscar-bot.com")
    main._verifier_configuration_courriel()


def test_sans_smtp_le_garde_fou_ne_bloque_pas(monkeypatch):
    """En developpement, l'URL par defaut ne doit empecher personne de demarrer."""
    from app import main
    from app.config import settings

    monkeypatch.setattr(settings, "smtp_host", "")
    monkeypatch.setattr(settings, "smtp_user", "")
    monkeypatch.setattr(settings, "public_app_url", "http://localhost:5173")
    main._verifier_configuration_courriel()


def test_me_expose_ce_dont_la_page_de_compte_a_besoin(client, compte_actif):
    """La page de compte affichait des valeurs vides faute de ces champs."""
    me = client.get("/api/auth/me", headers=compte_actif).json()
    for champ in ("statut", "roles", "active_org_nom"):
        assert champ in me, f"{champ} absent de /auth/me"
    assert me["statut"] == "active"
    assert isinstance(me["roles"], list)
