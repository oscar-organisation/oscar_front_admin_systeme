"""Amorçage portable : features (catalogue) + admin bootstrap + données de démo (JSON).

Les données de démo sont dans `app/seed_data/*.json` (éditables, sans hardcoding dans le code).
Désactivables via `SEED_DEMO=false`. Idempotent : ne rejoue pas la démo si des organisations existent.
"""
import json
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .models import (
    AiModel,
    DetectionCategory,
    Feature,
    Organisation,
    Robot,
    Role,
    RolePermission,
    Site,
    User,
    UserOrganisation,
    UserRole,
)
from .rbac import FEATURE_CATALOG
from .security import hash_password

_DEFAULT_DATA_DIR = Path(__file__).parent / "seed_data"


def _data_dir() -> Path:
    return Path(settings.seed_data_dir) if settings.seed_data_dir else _DEFAULT_DATA_DIR


def _load(name: str) -> list:
    path = _data_dir() / name
    if not path.exists():
        return []
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def sync_features(db: Session) -> None:
    existing = {f.code: f for f in db.execute(select(Feature)).scalars()}
    for code, label, ftype, module, actions in FEATURE_CATALOG:
        f = existing.get(code)
        if f:
            f.label, f.type, f.module, f.actions = label, ftype, module, actions
        else:
            db.add(Feature(code=code, label=label, type=ftype, module=module, actions=actions))
    db.commit()


def ensure_admin(db: Session) -> None:
    admin = db.execute(select(User).where(User.email == settings.admin_email)).scalar_one_or_none()
    if not admin:
        db.add(User(
            email=settings.admin_email, nom=settings.admin_name,
            password_hash=hash_password(settings.admin_password),
            statut="active", is_superadmin=True,
        ))
        db.commit()


def sync_system_role_permissions(db: Session) -> None:
    """Add newly catalogued features to existing system roles.

    Demo roles are created only once, but the feature catalogue evolves. This
    additive sync keeps deployed roles current without deleting permissions an
    administrator may have granted manually.
    """
    features = db.execute(select(Feature)).scalars().all()
    existing = {
        (permission.role_id, permission.feature_id)
        for permission in db.execute(select(RolePermission)).scalars()
    }

    for spec in _load("roles.json"):
        role = db.execute(select(Role).where(Role.nom == spec["nom"])).scalar_one_or_none()
        if not role or not role.is_system:
            continue
        modules = set(spec.get("modules") or [])
        for feature in features:
            if not spec.get("all") and feature.module not in modules:
                continue
            key = (role.id, feature.id)
            if key in existing:
                continue
            db.add(RolePermission(
                role_id=role.id,
                feature_id=feature.id,
                actions=list(feature.actions),
            ))
            existing.add(key)
    db.commit()


def _grant(db: Session, role: Role, spec: dict) -> None:
    features = db.execute(select(Feature)).scalars().all()
    modules = spec.get("modules")
    for f in features:
        if spec.get("all") or (modules and f.module in modules):
            db.add(RolePermission(role_id=role.id, feature_id=f.id, actions=list(f.actions)))
    db.commit()


def seed_demo(db: Session) -> None:
    if not settings.seed_demo:
        return
    if db.execute(select(Organisation)).first():
        return  # déjà semé

    orgs: dict[str, Organisation] = {}
    for row in _load("organisations.json"):
        org = Organisation(nom=row["nom"], slug=row["slug"],
                            contact=row.get("contact"), statut=row.get("statut", "active"))
        db.add(org)
        orgs[row["slug"]] = org
    db.commit()

    sites: dict[str, Site] = {}
    for row in _load("sites.json"):
        site = Site(org_id=orgs[row["org"]].id, nom=row["nom"], code=row["code"],
                    adresse=row.get("adresse"), zones=row.get("zones", []),
                    statut=row.get("statut", "operational"))
        db.add(site)
        sites[row["code"]] = site
    db.commit()

    roles: dict[str, Role] = {}
    for row in _load("roles.json"):
        role = Role(nom=row["nom"], description=row.get("description"),
                    is_system=row.get("system", False), visibility="public" if row.get("system") else "private")
        db.add(role)
        roles[row["nom"]] = role
    db.commit()
    for row in _load("roles.json"):
        _grant(db, roles[row["nom"]], row)

    for row in _load("users.json"):
        active = row.get("statut") == "active"
        user = User(
            email=row["email"], nom=row["nom"],
            org_id=orgs[row["org"]].id if row.get("org") else None,
            statut=row.get("statut", "invited"),
            password_hash=hash_password(settings.seed_user_password) if active else None,
        )
        db.add(user)
        db.flush()
        if user.org_id:
            db.add(UserOrganisation(user_id=user.id, org_id=user.org_id, is_primary=True))
        if row.get("role") and row["role"] in roles:
            if row.get("site"):
                scope_type, scope_id = "site", sites[row["site"]].id
            elif row.get("scope") == "all":
                scope_type, scope_id = "all", None
            else:
                scope_type, scope_id = "org", user.org_id
            db.add(UserRole(user_id=user.id, role_id=roles[row["role"]].id,
                            scope_type=scope_type, scope_id=scope_id))
    db.commit()

    for row in _load("robots.json"):
        db.add(Robot(
            nom=row["nom"], org_id=orgs[row["org"]].id, site_id=sites[row["site"]].id,
            serial=row.get("serial"), firmware=row.get("firmware"),
            statut=row.get("statut", "offline"), batterie=row.get("batterie"),
            capacites=row.get("capacites", []),
        ))

    default_org = next(iter(orgs.values()), None)
    for row in _load("categories.json"):
        db.add(DetectionCategory(
            org_id=(orgs[row["org"]].id if row.get("org") else (default_org.id if default_org else None)),
            code=row["code"], label=row["label"],
            couleur=row.get("couleur", "#22d3ee"), type=row.get("type", "retail"),
        ))

    for row in _load("models.json"):
        db.add(AiModel(
            org_id=orgs[row["org"]].id if row.get("org") else None,
            nom=row["nom"], version=row["version"], tache=row.get("tache", "detection"),
            framework=row.get("framework"), statut=row.get("statut", "sandbox"),
            metrics=row.get("metrics", {}),
        ))
    db.commit()


def run_seed(db: Session) -> None:
    sync_features(db)
    ensure_admin(db)
    seed_demo(db)
    sync_system_role_permissions(db)
