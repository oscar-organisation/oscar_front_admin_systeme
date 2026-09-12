from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .. import auth_tokens, mailer
from ..config import settings
from ..database import get_db
from ..deps import request_organisation_id, require, write_audit
from ..models import Organisation, Role, RoleGroup, User, UserOrganisation, UserRole, UserRoleGroup
from ..schemas import (
    OrganisationMembershipIn,
    IdSetIn,
    RoleAssignIn,
    RoleSetIn,
    UserIn,
    UserOut,
    UserRoleOut,
    UserUpdate,
)
from ..security import hash_password

router = APIRouter(prefix="/users", tags=["utilisateurs"])


def _user_out(user: User, org_nom: str | None = None) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        nom=user.nom,
        org_id=user.org_id,
        statut=user.statut,
        is_superadmin=user.is_superadmin,
        last_login_at=user.last_login_at,
        org_nom=org_nom,
        organisation_ids=[membership.org_id for membership in user.organisation_memberships],
        role_group_ids=[assignment.role_group_id for assignment in user.role_groups],
        roles=[
            UserRoleOut(
                role_id=assignment.role_id,
                role_nom=assignment.role.nom,
                scope_type=assignment.scope_type,
                scope_id=assignment.scope_id,
            )
            for assignment in user.roles
        ],
    )


def _load_user(db: Session, user_id: str) -> User | None:
    return db.execute(
        select(User)
        .where(User.id == user_id)
        .options(
            selectinload(User.roles).selectinload(UserRole.role),
            selectinload(User.organisation_memberships),
            selectinload(User.role_groups),
        )
    ).scalar_one_or_none()


def _org_name(db: Session, org_id: str | None) -> str | None:
    if not org_id:
        return None
    org = db.get(Organisation, org_id)
    return org.nom if org else None


@router.get("", response_model=list[UserOut])
def list_users(request: Request, org_id: str | None = None, db: Session = Depends(get_db),
               _=Depends(require("api:user.read"))):
    q = select(User).options(
        selectinload(User.roles).selectinload(UserRole.role),
        selectinload(User.organisation_memberships),
        selectinload(User.role_groups),
    ).order_by(User.nom)
    scoped_org_id = request_organisation_id(request)
    if scoped_org_id:
        q = q.join(UserOrganisation).where(UserOrganisation.org_id == scoped_org_id).distinct()
    elif org_id:
        q = q.where(User.org_id == org_id)
    users = db.execute(q).scalars().all()
    org_ids = {u.org_id for u in users if u.org_id}
    org_names = {
        org.id: org.nom
        for org in db.execute(select(Organisation).where(Organisation.id.in_(org_ids))).scalars()
    } if org_ids else {}
    return [_user_out(u, org_names.get(u.org_id)) for u in users]


@router.post("", response_model=UserOut, status_code=201)
def create_user(body: UserIn, db: Session = Depends(get_db),
                user=Depends(require("api:user.write", "create"))):
    if db.execute(select(User).where(User.email == body.email)).scalar_one_or_none():
        raise HTTPException(409, "E-mail déjà utilisé")
    u = User(
        email=body.email, nom=body.nom, org_id=body.org_id, statut=body.statut,
        password_hash=hash_password(body.password) if body.password else None,
    )
    db.add(u)
    db.commit()
    if u.org_id:
        db.add(UserOrganisation(user_id=u.id, org_id=u.org_id, is_primary=True))
        db.commit()
    u = _load_user(db, u.id)
    write_audit(db, actor=user, action="USER_CREATE", resource=u.email)

    # Compte cree sans mot de passe : on envoie une invitation plutot que de
    # laisser un administrateur transmettre un secret par un canal tiers.
    if not u.password_hash and u.statut == "invited":
        secret = auth_tokens.emettre(db, u, auth_tokens.INVITE)
        write_audit(db, actor=user, action="USER_INVITED", resource=u.email)
        db.commit()
        mailer.envoyer(
            mailer.courriel_invitation(
                u.nom,
                auth_tokens.lien("/accept-invitation", secret),
                settings.invite_ttl_hours,
            ),
            u.email,
        )
    return _user_out(u, _org_name(db, u.org_id))


@router.post("/{user_id}/resend-invitation", status_code=204)
def resend_invitation(user_id: str, db: Session = Depends(get_db),
                      user=Depends(require("api:user.write", "update"))):
    """Renvoie une invitation : le lien precedent est invalide au passage."""
    cible = db.get(User, user_id)
    if not cible:
        raise HTTPException(404, "Utilisateur introuvable")
    if cible.statut == "disabled":
        raise HTTPException(409, "Compte désactivé")
    if cible.password_hash and cible.statut == "active":
        raise HTTPException(409, "Ce compte est déjà activé")

    secret = auth_tokens.emettre(db, cible, auth_tokens.INVITE)
    write_audit(db, actor=user, action="USER_INVITE_RESENT", resource=cible.email)
    db.commit()
    mailer.envoyer(
        mailer.courriel_invitation(
            cible.nom,
            auth_tokens.lien("/accept-invitation", secret),
            settings.invite_ttl_hours,
        ),
        cible.email,
    )
    return None


@router.patch("/{user_id}", response_model=UserOut)
def update_user(user_id: str, body: UserUpdate, db: Session = Depends(get_db),
                user=Depends(require("api:user.write", "update"))):
    u = _load_user(db, user_id)
    if not u:
        raise HTTPException(404, "Utilisateur introuvable")

    changes = body.model_dump(exclude_unset=True)
    password = changes.pop("password", None)
    next_email = changes.get("email")
    if next_email and next_email != u.email:
        duplicate = db.execute(
            select(User).where(User.email == next_email, User.id != user_id)
        ).scalar_one_or_none()
        if duplicate:
            raise HTTPException(409, "E-mail déjà utilisé")

    for k, v in changes.items():
        setattr(u, k, v)
    if password:
        u.password_hash = hash_password(password)
    db.commit()
    u = _load_user(db, user_id)
    write_audit(db, actor=user, action="USER_UPDATE", resource=u.email)
    return _user_out(u, _org_name(db, u.org_id))


@router.delete("/{user_id}", status_code=204)
def delete_user(user_id: str, db: Session = Depends(get_db),
                user=Depends(require("api:user.write", "delete"))):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, "Utilisateur introuvable")
    db.delete(u)
    db.commit()
    write_audit(db, actor=user, action="USER_DELETE", resource=u.email)


@router.post("/{user_id}/roles", status_code=204)
def assign_role(user_id: str, body: RoleAssignIn, db: Session = Depends(get_db),
                user=Depends(require("api:user.write", "update"))):
    if not db.get(User, user_id):
        raise HTTPException(404, "Utilisateur introuvable")
    if not db.get(Role, body.role_id):
        raise HTTPException(404, "Rôle introuvable")
    db.add(UserRole(user_id=user_id, role_id=body.role_id,
                    scope_type=body.scope_type, scope_id=body.scope_id))
    db.commit()
    write_audit(db, actor=user, action="USER_ROLE_ASSIGN", resource=f"{user_id}:{body.role_id}")


@router.put("/{user_id}/roles", response_model=UserOut)
def set_roles(user_id: str, body: RoleSetIn, db: Session = Depends(get_db),
              user=Depends(require("api:user.write", "update"))):
    target = _load_user(db, user_id)
    if not target:
        raise HTTPException(404, "Utilisateur introuvable")

    role_ids = list(dict.fromkeys(body.role_ids))
    roles = db.execute(select(Role).where(Role.id.in_(role_ids))).scalars().all() if role_ids else []
    if len(roles) != len(role_ids):
        raise HTTPException(404, "Un ou plusieurs rôles sont introuvables")

    for assignment in list(target.roles):
        db.delete(assignment)
    db.flush()
    for role_id in role_ids:
        db.add(UserRole(user_id=user_id, role_id=role_id, scope_type="all", scope_id=None))
    db.commit()

    target = _load_user(db, user_id)
    write_audit(db, actor=user, action="USER_ROLES_SET", resource=user_id)
    return _user_out(target, _org_name(db, target.org_id))


@router.put("/{user_id}/organisations", response_model=UserOut)
def set_organisations(
    user_id: str,
    body: OrganisationMembershipIn,
    db: Session = Depends(get_db),
    actor=Depends(require("api:user.write", "update")),
):
    target = _load_user(db, user_id)
    if not target:
        raise HTTPException(404, "Utilisateur introuvable")
    org_ids = list(dict.fromkeys(body.org_ids))
    valid_ids = set(
        db.execute(select(Organisation.id).where(Organisation.id.in_(org_ids))).scalars()
    ) if org_ids else set()
    if valid_ids != set(org_ids):
        raise HTTPException(400, "Une organisation sélectionnée est inconnue")
    if body.primary_org_id and body.primary_org_id not in valid_ids:
        raise HTTPException(400, "L'organisation principale doit appartenir à la sélection")
    for membership in list(target.organisation_memberships):
        db.delete(membership)
    db.flush()
    for org_id in org_ids:
        db.add(UserOrganisation(
            user_id=user_id,
            org_id=org_id,
            is_primary=(org_id == body.primary_org_id),
        ))
    target.org_id = body.primary_org_id or (org_ids[0] if org_ids else None)
    db.commit()
    refreshed = _load_user(db, user_id)
    write_audit(db, actor=actor, action="USER_ORGANISATIONS_SET", resource=target.email)
    return _user_out(refreshed, _org_name(db, refreshed.org_id))


@router.put("/{user_id}/role-groups", status_code=204)
def set_role_groups(
    user_id: str,
    body: IdSetIn,
    db: Session = Depends(get_db),
    actor=Depends(require("api:user.write", "update")),
):
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(404, "Utilisateur introuvable")
    group_ids = list(dict.fromkeys(body.ids))
    valid_ids = set(
        db.execute(select(RoleGroup.id).where(RoleGroup.id.in_(group_ids))).scalars()
    ) if group_ids else set()
    if valid_ids != set(group_ids):
        raise HTTPException(400, "Un groupe de rôles sélectionné est inconnu")
    db.query(UserRoleGroup).filter(UserRoleGroup.user_id == user_id).delete()
    for group_id in group_ids:
        db.add(UserRoleGroup(
            user_id=user_id, role_group_id=group_id, scope_type="all", scope_id=None
        ))
    db.commit()
    write_audit(db, actor=actor, action="USER_ROLE_GROUPS_SET", resource=target.email)
