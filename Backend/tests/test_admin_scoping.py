"""Distinction entre super administrateur de plateforme et administrateur d'organisation.

Les deux portent le même rôle « Administrateur » et donc les mêmes permissions
fonctionnelles. Ce qui les sépare n'est pas ce qu'ils peuvent faire, mais où :
le premier court-circuite le périmètre, le second est borné à ses organisations
et à leurs descendantes.
"""

import uuid

import pytest

from app.database import SessionLocal
from app.deps import accessible_organisation_ids, compute_permissions, compute_role_names
from app.models import Organisation, Role, User, UserOrganisation, UserRole
from app.security import hash_password


@pytest.fixture()
def db(client):
    # Depend de `client` : c'est le demarrage de l'application qui cree les
    # tables et charge les roles systeme (dont « Administrateur »).
    s = SessionLocal()
    try:
        yield s
    finally:
        s.close()


@pytest.fixture()
def arbre(db):
    """Deux branches independantes, dont une avec une filiale."""
    suffixe = uuid.uuid4().hex[:6]
    mere = Organisation(nom=f"Groupe {suffixe}", slug=f"groupe-{suffixe}")
    db.add(mere); db.flush()
    filiale = Organisation(nom=f"Filiale {suffixe}", slug=f"filiale-{suffixe}", parent_id=mere.id)
    etrangere = Organisation(nom=f"Tiers {suffixe}", slug=f"tiers-{suffixe}")
    db.add_all([filiale, etrangere]); db.commit()
    return {"mere": mere, "filiale": filiale, "etrangere": etrangere}


def _admin_organisation(db, org):
    """Utilisateur portant le role Administrateur, borne a une organisation."""
    role = db.query(Role).filter(Role.nom == "Administrateur").one()
    u = User(
        email=f"admin-{uuid.uuid4().hex[:8]}@exemple.fr",
        nom="Admin d'organisation",
        statut="active",
        password_hash=hash_password("un-mot-de-passe-assez-long"),
        org_id=org.id,
        is_superadmin=False,
    )
    db.add(u); db.flush()
    db.add(UserOrganisation(user_id=u.id, org_id=org.id, is_primary=True))
    db.add(UserRole(user_id=u.id, role_id=role.id, scope_type="org", scope_id=org.id))
    db.commit()
    return u


def test_le_superadmin_nest_borne_par_aucun_perimetre(db):
    sa = db.query(User).filter(User.is_superadmin.is_(True)).first()
    assert sa is not None
    # None signifie « aucune restriction », et non « aucune organisation ».
    assert accessible_organisation_ids(db, sa) is None


def test_ladmin_dorganisation_voit_sa_branche_et_ses_descendants(db, arbre):
    u = _admin_organisation(db, arbre["mere"])
    visibles = accessible_organisation_ids(db, u)

    assert visibles is not None, "un administrateur d'organisation doit rester borne"
    assert arbre["mere"].id in visibles
    assert arbre["filiale"].id in visibles, "la filiale doit etre heritee"
    assert arbre["etrangere"].id not in visibles, "une branche tierce doit rester invisible"


def test_memes_permissions_dans_son_perimetre_que_le_superadmin(db, arbre):
    """Le role est le meme : seul le perimetre d'application change."""
    sa = db.query(User).filter(User.is_superadmin.is_(True)).first()
    u = _admin_organisation(db, arbre["mere"])

    droits_sa = compute_permissions(db, sa, arbre["mere"].id)
    droits_admin = compute_permissions(db, u, arbre["mere"].id)

    assert droits_admin, "l'administrateur d'organisation doit avoir des droits chez lui"
    manquants = set(droits_sa) - set(droits_admin)
    assert not manquants, f"droits absents dans son propre perimetre : {sorted(manquants)}"


def test_aucun_droit_hors_de_son_perimetre(db, arbre):
    """C'est la garantie qui distingue les deux profils."""
    u = _admin_organisation(db, arbre["mere"])
    assert compute_permissions(db, u, arbre["etrangere"].id) == {}
    assert compute_role_names(db, u, arbre["etrangere"].id) == []


def test_le_role_est_bien_porte_dans_son_perimetre(db, arbre):
    u = _admin_organisation(db, arbre["mere"])
    assert "Administrateur" in compute_role_names(db, u, arbre["mere"].id)
    assert "Administrateur" in compute_role_names(db, u, arbre["filiale"].id)
