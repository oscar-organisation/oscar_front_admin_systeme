from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import request_organisation_id, require, write_audit
from ..models import Feature, PermissionGroup, Role, RolePermission, RolePermissionGroup
from ..schemas import FeatureOut, IdSetIn, PermissionIn, RoleDetailOut, RoleIn, RoleOut

router = APIRouter(tags=["roles"])


@router.get("/features", response_model=list[FeatureOut])
def list_features(db: Session = Depends(get_db), _=Depends(require("api:feature.read"))):
    return db.execute(select(Feature).order_by(Feature.module, Feature.type, Feature.code)).scalars().all()


@router.get("/roles", response_model=list[RoleOut])
def list_roles(request: Request, db: Session = Depends(get_db),
               _=Depends(require("api:role.read"))):
    query = select(Role).order_by(Role.nom)
    scoped_org_id = request_organisation_id(request)
    if scoped_org_id:
        query = query.where(or_(Role.visibility == "public", Role.org_id == scoped_org_id))
    return db.execute(query).scalars().all()


@router.post("/roles", response_model=RoleOut, status_code=201)
def create_role(body: RoleIn, db: Session = Depends(get_db),
                user=Depends(require("api:role.write", "create"))):
    role = Role(**body.model_dump())
    db.add(role)
    db.commit()
    db.refresh(role)
    write_audit(db, actor=user, action="ROLE_CREATE", resource=role.nom)
    return role


def _role_detail(role: Role) -> RoleDetailOut:
    perms = [
        PermissionIn(feature_code=rp.feature.code, actions=rp.actions)
        for rp in role.permissions
    ]
    return RoleDetailOut(
        id=role.id, nom=role.nom, description=role.description, org_id=role.org_id,
        is_system=role.is_system, visibility=role.visibility, permissions=perms,
        permission_group_ids=[item.permission_group_id for item in role.permission_groups],
    )


@router.get("/roles/{role_id}", response_model=RoleDetailOut)
def get_role(role_id: str, db: Session = Depends(get_db), _=Depends(require("api:role.read"))):
    role = db.get(Role, role_id)
    if not role:
        raise HTTPException(404, "Rôle introuvable")
    return _role_detail(role)


@router.patch("/roles/{role_id}", response_model=RoleOut)
def update_role(role_id: str, body: RoleIn, db: Session = Depends(get_db),
                user=Depends(require("api:role.write", "update"))):
    role = db.get(Role, role_id)
    if not role:
        raise HTTPException(404, "Rôle introuvable")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(role, k, v)
    db.commit()
    db.refresh(role)
    write_audit(db, actor=user, action="ROLE_UPDATE", resource=role.nom)
    return role


@router.put("/roles/{role_id}/permissions", response_model=RoleDetailOut)
def set_permissions(role_id: str, body: list[PermissionIn], db: Session = Depends(get_db),
                    user=Depends(require("api:role.write", "update"))):
    role = db.get(Role, role_id)
    if not role:
        raise HTTPException(404, "Rôle introuvable")
    codes = {f.code: f for f in db.execute(select(Feature)).scalars()}
    # remplace intégralement la matrice de droits du rôle
    for rp in list(role.permissions):
        db.delete(rp)
    db.flush()  # exécute les suppressions AVANT les insertions (sinon conflit d'unicité sur Postgres)
    for perm in body:
        feat = codes.get(perm.feature_code)
        if not feat:
            raise HTTPException(400, f"Fonctionnalité inconnue : {perm.feature_code}")
        valid = [a for a in perm.actions if a in (feat.actions or [])]
        if valid:
            db.add(RolePermission(role_id=role.id, feature_id=feat.id, actions=valid))
    db.commit()
    db.refresh(role)
    write_audit(db, actor=user, action="ROLE_PERMISSIONS_SET", resource=role.nom)
    return _role_detail(role)


@router.put("/roles/{role_id}/permission-groups", response_model=RoleDetailOut)
def set_permission_groups(
    role_id: str,
    body: IdSetIn,
    db: Session = Depends(get_db),
    user=Depends(require("api:role.write", "update")),
):
    role = db.get(Role, role_id)
    if not role:
        raise HTTPException(404, "Rôle introuvable")
    group_ids = list(dict.fromkeys(body.ids))
    valid_ids = set(
        db.execute(select(PermissionGroup.id).where(PermissionGroup.id.in_(group_ids))).scalars()
    ) if group_ids else set()
    if valid_ids != set(group_ids):
        raise HTTPException(400, "Un groupe de permissions est inconnu")
    for assignment in list(role.permission_groups):
        db.delete(assignment)
    db.flush()
    for group_id in group_ids:
        db.add(RolePermissionGroup(role_id=role_id, permission_group_id=group_id))
    db.commit()
    db.refresh(role)
    write_audit(db, actor=user, action="ROLE_PERMISSION_GROUPS_SET", resource=role.nom)
    return _role_detail(role)


@router.delete("/roles/{role_id}", status_code=204)
def delete_role(role_id: str, db: Session = Depends(get_db),
                user=Depends(require("api:role.write", "delete"))):
    role = db.get(Role, role_id)
    if not role:
        raise HTTPException(404, "Rôle introuvable")
    if role.is_system:
        raise HTTPException(400, "Rôle système non supprimable")
    db.delete(role)
    db.commit()
    write_audit(db, actor=user, action="ROLE_DELETE", resource=role.nom)
