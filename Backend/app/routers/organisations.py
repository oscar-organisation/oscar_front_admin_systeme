from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..deps import accessible_organisation_ids, require, write_audit
from ..models import Organisation, Role, Site, User, UserOrganisation, UserRole
from ..schemas import OrganisationOnboardingIn, OrganisationOnboardingOut, OrgIn, OrgOut
from ..security import hash_password

router = APIRouter(prefix="/organisations", tags=["organisations"])


def _org_out(org: Organisation, depth: int = 0) -> OrgOut:
    return OrgOut(
        id=org.id,
        nom=org.nom,
        slug=org.slug,
        contact=org.contact,
        statut=org.statut,
        category_id=org.category_id,
        parent_id=org.parent_id,
        created_at=org.created_at,
        category_nom=org.category.nom if org.category else None,
        parent_nom=org.parent.nom if org.parent else None,
        depth=depth,
    )


def _org_query():
    return select(Organisation).options(
        selectinload(Organisation.category), selectinload(Organisation.parent)
    )


@router.get("", response_model=list[OrgOut])
def list_orgs(db: Session = Depends(get_db), user=Depends(require("api:org.read"))):
    query = _org_query().order_by(Organisation.nom)
    allowed = accessible_organisation_ids(db, user)
    if allowed is not None:
        query = query.where(Organisation.id.in_(allowed))
    orgs = db.execute(query).scalars().all()
    return [_org_out(org) for org in orgs]


@router.get("/tree", response_model=list[OrgOut])
def organisation_tree(db: Session = Depends(get_db), user=Depends(require("api:org.read"))):
    query = _org_query().order_by(Organisation.nom)
    allowed = accessible_organisation_ids(db, user)
    if allowed is not None:
        query = query.where(Organisation.id.in_(allowed))
    orgs = db.execute(query).scalars().all()
    by_parent: dict[str | None, list[Organisation]] = {}
    for org in orgs:
        by_parent.setdefault(org.parent_id, []).append(org)
    result: list[OrgOut] = []

    def visit(parent_id: str | None, depth: int, visited: set[str]) -> None:
        for org in by_parent.get(parent_id, []):
            if org.id in visited:
                continue
            visited.add(org.id)
            result.append(_org_out(org, depth))
            visit(org.id, depth + 1, visited)

    visited: set[str] = set()
    visit(None, 0, visited)
    for org in orgs:
        if org.id not in visited:
            result.append(_org_out(org, 0))
    return result


@router.post("", response_model=OrgOut, status_code=201)
def create_org(body: OrgIn, request: Request, db: Session = Depends(get_db),
               user=Depends(require("api:org.write", "create"))):
    if body.parent_id and not db.get(Organisation, body.parent_id):
        raise HTTPException(400, "Organisation parente inconnue")
    org = Organisation(**body.model_dump())
    db.add(org)
    db.commit()
    db.refresh(org)
    write_audit(db, actor=user, action="ORG_CREATE", resource=org.nom)
    return _org_out(org)


@router.post("/onboard", response_model=OrganisationOnboardingOut, status_code=201)
def onboard_organisation(
    body: OrganisationOnboardingIn,
    db: Session = Depends(get_db),
    user=Depends(require("api:org.write", "create")),
):
    """Create a tenant, its first site and its initial administrator atomically."""
    if db.execute(
        select(Organisation).where(Organisation.slug == body.organisation.slug)
    ).scalar_one_or_none():
        raise HTTPException(409, "Cet identifiant d'organisation existe déjà")
    if db.execute(select(User).where(User.email == body.administrator.email)).scalar_one_or_none():
        raise HTTPException(409, "Cette adresse email est déjà utilisée")
    if body.organisation.parent_id and not db.get(Organisation, body.organisation.parent_id):
        raise HTTPException(400, "Organisation parente inconnue")

    role_ids = list(dict.fromkeys(body.administrator.role_ids))
    roles = db.execute(select(Role).where(Role.id.in_(role_ids))).scalars().all() if role_ids else []
    if {role.id for role in roles} != set(role_ids):
        raise HTTPException(400, "Un rôle sélectionné est inconnu")
    if any(role.visibility != "public" and role.org_id is not None for role in roles):
        raise HTTPException(400, "Le rôle initial doit être public")

    organisation = Organisation(**body.organisation.model_dump())
    db.add(organisation)
    db.flush()

    site = None
    if body.site:
        site = Site(
            org_id=organisation.id,
            nom=body.site.nom,
            code=body.site.code,
            adresse=body.site.adresse,
            zones=[],
            statut="operational",
        )
        db.add(site)

    administrator = User(
        org_id=organisation.id,
        nom=body.administrator.nom,
        email=body.administrator.email,
        password_hash=hash_password(body.administrator.password),
        statut="active",
    )
    db.add(administrator)
    db.flush()
    db.add(UserOrganisation(
        user_id=administrator.id,
        org_id=organisation.id,
        is_primary=True,
    ))
    for role in roles:
        db.add(UserRole(
            user_id=administrator.id,
            role_id=role.id,
            scope_type="org",
            scope_id=organisation.id,
        ))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Impossible de créer ce client avec ces identifiants")

    write_audit(
        db,
        actor=user,
        action="ORGANISATION_ONBOARD",
        resource=f"{organisation.nom}:{administrator.email}",
    )
    return OrganisationOnboardingOut(
        organisation_id=organisation.id,
        site_id=site.id if site else None,
        administrator_id=administrator.id,
    )


@router.get("/{org_id}", response_model=OrgOut)
def get_org(org_id: str, db: Session = Depends(get_db), user=Depends(require("api:org.read"))):
    allowed = accessible_organisation_ids(db, user)
    if allowed is not None and org_id not in allowed:
        raise HTTPException(404, "Organisation introuvable")
    org = db.execute(_org_query().where(Organisation.id == org_id)).scalar_one_or_none()
    if not org:
        raise HTTPException(404, "Organisation introuvable")
    return _org_out(org)


@router.patch("/{org_id}", response_model=OrgOut)
def update_org(org_id: str, body: OrgIn, db: Session = Depends(get_db),
               user=Depends(require("api:org.write", "update"))):
    org = db.get(Organisation, org_id)
    if not org:
        raise HTTPException(404, "Organisation introuvable")
    data = body.model_dump(exclude_unset=True)
    if data.get("parent_id") == org_id:
        raise HTTPException(400, "Une organisation ne peut pas être son propre parent")
    parent_id = data.get("parent_id")
    seen = {org_id}
    while parent_id:
        if parent_id in seen:
            raise HTTPException(400, "Cette hiérarchie créerait un cycle")
        seen.add(parent_id)
        parent = db.get(Organisation, parent_id)
        if not parent:
            raise HTTPException(400, "Organisation parente inconnue")
        parent_id = parent.parent_id
    for k, v in data.items():
        setattr(org, k, v)
    db.commit()
    db.refresh(org)
    write_audit(db, actor=user, action="ORG_UPDATE", resource=org.nom)
    org = db.execute(_org_query().where(Organisation.id == org_id)).scalar_one()
    return _org_out(org)


@router.delete("/{org_id}", status_code=204)
def delete_org(org_id: str, db: Session = Depends(get_db),
               user=Depends(require("api:org.write", "delete"))):
    org = db.get(Organisation, org_id)
    if not org:
        raise HTTPException(404, "Organisation introuvable")
    db.delete(org)
    db.commit()
    write_audit(db, actor=user, action="ORG_DELETE", resource=org.nom)
