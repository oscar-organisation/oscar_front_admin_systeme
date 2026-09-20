"""Étanchéité entre organisations pour un administrateur non superadmin.

Le moteur de permissions répond à la question « a-t-il le droit ? ». Ces tests
posent l'autre question, celle qui fait la multi-location : « sur quoi ? ».
Un administrateur d'organisation porte les mêmes permissions qu'un super
administrateur ; seul son périmètre doit le borner.
"""

import uuid

import pytest

from app.database import SessionLocal
from app.models import Organisation, Robot, Role, Site, User, UserOrganisation, UserRole
from app.security import hash_password

PREFIXE = "/api"


@pytest.fixture()
def db(client):
    s = SessionLocal()
    try:
        yield s
    finally:
        s.close()


@pytest.fixture()
def deux_locataires(db):
    """Deux organisations sans lien, chacune avec un site et un robot."""
    s = uuid.uuid4().hex[:6]
    a = Organisation(nom=f"Enseigne A {s}", slug=f"ens-a-{s}")
    b = Organisation(nom=f"Enseigne B {s}", slug=f"ens-b-{s}")
    db.add_all([a, b]); db.flush()
    site_a = Site(org_id=a.id, nom=f"Magasin A {s}", code=f"MA-{s}")
    site_b = Site(org_id=b.id, nom=f"Magasin B {s}", code=f"MB-{s}")
    db.add_all([site_a, site_b]); db.flush()
    robot_a = Robot(org_id=a.id, site_id=site_a.id, nom=f"OSCAR-A-{s}")
    robot_b = Robot(org_id=b.id, site_id=site_b.id, nom=f"OSCAR-B-{s}")
    db.add_all([robot_a, robot_b])

    mdp = "un-mot-de-passe-assez-long"
    role = db.query(Role).filter(Role.nom == "Administrateur").one()
    admin_a = User(email=f"admin-a-{s}@exemple.fr", nom="Admin A", statut="active",
                   password_hash=hash_password(mdp), org_id=a.id, is_superadmin=False)
    membre_b = User(email=f"membre-b-{s}@exemple.fr", nom="Membre B", statut="active",
                    password_hash=hash_password(mdp), org_id=b.id, is_superadmin=False)
    db.add_all([admin_a, membre_b]); db.flush()
    db.add_all([
        UserOrganisation(user_id=admin_a.id, org_id=a.id, is_primary=True),
        UserOrganisation(user_id=membre_b.id, org_id=b.id, is_primary=True),
        UserRole(user_id=admin_a.id, role_id=role.id, scope_type="all", scope_id=None),
    ])
    db.commit()
    return {
        "org_a": a.id, "org_b": b.id,
        "site_a": site_a.id, "site_b": site_b.id,
        "robot_a": robot_a.id, "robot_b": robot_b.id,
        "admin_a": admin_a.email, "membre_b": membre_b.id,
        "mdp": mdp,
    }


@pytest.fixture()
def entetes_admin_a(client, deux_locataires):
    r = client.post(f"{PREFIXE}/auth/login",
                    json={"email": deux_locataires["admin_a"], "password": deux_locataires["mdp"]})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


# --------------------------------------------------------------------------- #
#  Ce qui doit lui être ouvert : son organisation
# --------------------------------------------------------------------------- #
def test_il_administre_bien_la_sienne(client, entetes_admin_a, deux_locataires):
    r = client.get(f"{PREFIXE}/robots/{deux_locataires['robot_a']}", headers=entetes_admin_a)
    assert r.status_code == 200, r.text
    r = client.get(f"{PREFIXE}/sites/{deux_locataires['site_a']}", headers=entetes_admin_a)
    assert r.status_code == 200, r.text


def test_les_listes_ne_montrent_que_son_perimetre(client, entetes_admin_a, deux_locataires):
    robots = client.get(f"{PREFIXE}/robots", headers=entetes_admin_a).json()
    ids = {x["id"] for x in robots}
    assert deux_locataires["robot_a"] in ids
    assert deux_locataires["robot_b"] not in ids


def test_la_vue_globale_lui_est_refusee(client, entetes_admin_a):
    r = client.get(f"{PREFIXE}/robots",
                   headers={**entetes_admin_a, "X-Organization-ID": "*"})
    assert r.status_code == 403


def test_il_ne_peut_pas_basculer_sur_lautre_organisation(client, entetes_admin_a, deux_locataires):
    r = client.get(f"{PREFIXE}/robots",
                   headers={**entetes_admin_a, "X-Organization-ID": deux_locataires["org_b"]})
    assert r.status_code == 403


# --------------------------------------------------------------------------- #
#  Ce qui doit lui rester fermé : l'organisation voisine, même par identifiant
# --------------------------------------------------------------------------- #
def test_un_robot_voisin_reste_hors_de_portee(client, entetes_admin_a, deux_locataires):
    r = client.get(f"{PREFIXE}/robots/{deux_locataires['robot_b']}", headers=entetes_admin_a)
    assert r.status_code == 404, r.text


def test_il_ne_peut_pas_modifier_un_robot_voisin(client, entetes_admin_a, deux_locataires):
    r = client.patch(f"{PREFIXE}/robots/{deux_locataires['robot_b']}",
                     headers=entetes_admin_a, json={"nom": "Detourne"})
    assert r.status_code == 404, r.text


def test_il_ne_peut_pas_emettre_de_jeton_sur_un_robot_voisin(client, entetes_admin_a, deux_locataires):
    """Le plus sensible : ces jetons ouvrent le flux vidéo et la téléopération."""
    r = client.post(f"{PREFIXE}/robots/{deux_locataires['robot_b']}/tokens",
                    headers=entetes_admin_a, json={"identity": "intrus"})
    assert r.status_code == 404, r.text


def test_il_ne_recupere_pas_les_acces_livekit_dun_robot_voisin(client, entetes_admin_a, deux_locataires):
    r = client.get(f"{PREFIXE}/robots/{deux_locataires['robot_b']}/integration",
                   headers=entetes_admin_a)
    assert r.status_code == 404, r.text


def test_un_site_voisin_reste_hors_de_portee(client, entetes_admin_a, deux_locataires):
    r = client.get(f"{PREFIXE}/sites/{deux_locataires['site_b']}", headers=entetes_admin_a)
    assert r.status_code == 404, r.text


def test_il_ne_peut_pas_supprimer_un_site_voisin(client, entetes_admin_a, deux_locataires):
    r = client.delete(f"{PREFIXE}/sites/{deux_locataires['site_b']}", headers=entetes_admin_a)
    assert r.status_code == 404, r.text


def test_un_utilisateur_voisin_reste_hors_de_portee(client, entetes_admin_a, deux_locataires):
    r = client.patch(f"{PREFIXE}/users/{deux_locataires['membre_b']}",
                     headers=entetes_admin_a, json={"nom": "Detourne"})
    assert r.status_code == 404, r.text


# --------------------------------------------------------------------------- #
#  Le journal d'audit : une trace lisible chez soi, muette sur le voisin
# --------------------------------------------------------------------------- #
def test_son_action_est_estampillee_a_son_organisation(client, entetes_admin_a, deux_locataires, db):
    from app.models import AuditLog

    r = client.patch(f"{PREFIXE}/robots/{deux_locataires['robot_a']}",
                     headers=entetes_admin_a, json={"nom": "OSCAR-A-renomme"})
    assert r.status_code == 200, r.text

    ligne = db.query(AuditLog).filter(AuditLog.action == "ROBOT_UPDATE").order_by(
        AuditLog.ts.desc()).first()
    assert ligne is not None
    assert ligne.org_id == deux_locataires["org_a"]


def test_le_journal_du_voisin_reste_invisible(client, entetes_admin_a, deux_locataires, db):
    from app.models import AuditLog

    db.add_all([
        AuditLog(action="TEST_CHEZ_A", resource="a", org_id=deux_locataires["org_a"]),
        AuditLog(action="TEST_CHEZ_B", resource="b", org_id=deux_locataires["org_b"]),
        AuditLog(action="TEST_SANS_ORG", resource="systeme", org_id=None),
    ])
    db.commit()

    actions = {x["action"] for x in client.get(f"{PREFIXE}/audit?limit=500",
                                               headers=entetes_admin_a).json()}
    assert "TEST_CHEZ_A" in actions
    assert "TEST_CHEZ_B" not in actions
    assert "TEST_SANS_ORG" not in actions


def test_le_superadmin_lit_tout_le_journal(client, admin_headers, deux_locataires, db):
    from app.models import AuditLog

    db.add_all([
        AuditLog(action="TEST_GLOBAL_A", resource="a", org_id=deux_locataires["org_a"]),
        AuditLog(action="TEST_GLOBAL_B", resource="b", org_id=deux_locataires["org_b"]),
    ])
    db.commit()

    actions = {x["action"] for x in client.get(
        f"{PREFIXE}/audit?limit=500",
        headers={**admin_headers, "X-Organization-ID": "*"}).json()}
    assert {"TEST_GLOBAL_A", "TEST_GLOBAL_B"} <= actions


def test_il_ne_peut_pas_deplacer_un_compte_chez_le_voisin(client, entetes_admin_a, deux_locataires, db):
    """Deplacer un compte revient a lui ouvrir une organisation : meme regle."""
    from app.models import User

    sien = db.query(User).filter(User.email == deux_locataires["admin_a"]).one()
    r = client.patch(f"{PREFIXE}/users/{sien.id}", headers=entetes_admin_a,
                     json={"org_id": deux_locataires["org_b"]})
    assert r.status_code == 403, r.text


def test_un_site_cree_nait_dans_son_organisation(client, entetes_admin_a, deux_locataires):
    """Le corps de la requete ne doit pas pouvoir designer une autre organisation."""
    r = client.post(f"{PREFIXE}/sites", headers=entetes_admin_a,
                    json={"nom": "Magasin tente", "code": "TENTE-1",
                          "org_id": deux_locataires["org_b"]})
    assert r.status_code == 201, r.text
    assert r.json()["org_id"] == deux_locataires["org_a"]


# --------------------------------------------------------------------------- #
#  La hierarchie : un super administrateur rattache a un locataire n'est pas
#  pour autant administrable par ce locataire.
#
#  Situation reelle observee en production : le compte super administrateur
#  avait ete rattache a une organisation cliente, et l'administrateur de cette
#  organisation avait pu lui changer d'organisation et de roles.
# --------------------------------------------------------------------------- #
@pytest.fixture()
def superadmin_rattache(db, deux_locataires):
    """Un super administrateur membre de l'organisation A, comme en production."""
    from app.models import UserOrganisation as UO

    sa = db.query(User).filter(User.is_superadmin.is_(True)).first()
    deja = db.query(UO).filter(UO.user_id == sa.id, UO.org_id == deux_locataires["org_a"]).first()
    if not deja:
        db.add(UO(user_id=sa.id, org_id=deux_locataires["org_a"], is_primary=False))
        db.commit()
    return sa


def test_le_superadmin_napparait_pas_dans_la_liste_du_locataire(
        client, entetes_admin_a, superadmin_rattache):
    ids = {u["id"] for u in client.get(f"{PREFIXE}/users", headers=entetes_admin_a).json()}
    assert superadmin_rattache.id not in ids


def test_le_superadmin_le_voit_toujours(client, admin_headers, superadmin_rattache):
    ids = {u["id"] for u in client.get(f"{PREFIXE}/users",
                                       headers={**admin_headers, "X-Organization-ID": "*"}).json()}
    assert superadmin_rattache.id in ids


def test_un_admin_de_locataire_ne_deplace_pas_le_superadmin(
        client, entetes_admin_a, superadmin_rattache, deux_locataires):
    r = client.patch(f"{PREFIXE}/users/{superadmin_rattache.id}", headers=entetes_admin_a,
                     json={"org_id": deux_locataires["org_a"]})
    assert r.status_code == 404, r.text


def test_un_admin_de_locataire_ne_rattache_pas_le_superadmin(
        client, entetes_admin_a, superadmin_rattache, deux_locataires):
    r = client.put(f"{PREFIXE}/users/{superadmin_rattache.id}/organisations",
                   headers=entetes_admin_a,
                   json={"org_ids": [deux_locataires["org_a"]],
                         "primary_org_id": deux_locataires["org_a"]})
    assert r.status_code == 404, r.text


def test_un_admin_de_locataire_ne_touche_pas_aux_roles_du_superadmin(
        client, entetes_admin_a, superadmin_rattache, db):
    role = db.query(Role).filter(Role.nom == "Administrateur").one()
    r = client.put(f"{PREFIXE}/users/{superadmin_rattache.id}/roles",
                   headers=entetes_admin_a, json={"role_ids": []})
    assert r.status_code == 404, r.text
    r = client.post(f"{PREFIXE}/users/{superadmin_rattache.id}/roles",
                    headers=entetes_admin_a, json={"role_id": role.id})
    assert r.status_code == 404, r.text


def test_un_admin_de_locataire_ne_supprime_pas_le_superadmin(
        client, entetes_admin_a, superadmin_rattache):
    r = client.delete(f"{PREFIXE}/users/{superadmin_rattache.id}", headers=entetes_admin_a)
    assert r.status_code == 404, r.text


# --------------------------------------------------------------------------- #
#  Pas d'escalade par attribution de role
# --------------------------------------------------------------------------- #
def test_on_ne_confere_pas_un_role_plus_puissant_que_le_sien(client, admin_headers, db,
                                                             deux_locataires):
    """Un gestionnaire qui peut creer des comptes ne peut pas fabriquer un administrateur."""
    s = uuid.uuid4().hex[:6]
    restreint = client.post(f"{PREFIXE}/roles", headers=admin_headers,
                            json={"nom": f"Gestionnaire de comptes {s}"}).json()
    client.put(f"{PREFIXE}/roles/{restreint['id']}/permissions", headers=admin_headers, json=[
        {"feature_code": "api:user.read", "actions": ["view"]},
        {"feature_code": "api:user.write", "actions": ["create", "update", "delete"]},
    ])

    mdp = "un-mot-de-passe-assez-long"
    gestionnaire = User(email=f"gestion-{s}@exemple.fr", nom="Gestionnaire", statut="active",
                        password_hash=hash_password(mdp), org_id=deux_locataires["org_a"])
    db.add(gestionnaire); db.flush()
    db.add_all([
        UserOrganisation(user_id=gestionnaire.id, org_id=deux_locataires["org_a"], is_primary=True),
        UserRole(user_id=gestionnaire.id, role_id=restreint["id"], scope_type="all", scope_id=None),
    ])
    cible = User(email=f"cible-{s}@exemple.fr", nom="Cible", statut="active",
                 password_hash=hash_password(mdp), org_id=deux_locataires["org_a"])
    db.add(cible); db.flush()
    db.add(UserOrganisation(user_id=cible.id, org_id=deux_locataires["org_a"], is_primary=True))
    db.commit()

    jeton = client.post(f"{PREFIXE}/auth/login",
                        json={"email": gestionnaire.email, "password": mdp}).json()
    entetes = {"Authorization": f"Bearer {jeton['access_token']}"}

    administrateur = db.query(Role).filter(Role.nom == "Administrateur").one()
    r = client.put(f"{PREFIXE}/users/{cible.id}/roles", headers=entetes,
                   json={"role_ids": [administrateur.id]})
    assert r.status_code == 403, r.text

    # Le role qu'il detient lui-meme reste attribuable.
    r = client.put(f"{PREFIXE}/users/{cible.id}/roles", headers=entetes,
                   json={"role_ids": [restreint["id"]]})
    assert r.status_code == 200, r.text
