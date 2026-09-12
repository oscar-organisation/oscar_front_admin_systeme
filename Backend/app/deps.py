from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from .database import get_db
from .models import (
    AuditLog,
    Feature,
    PermissionGroupPermission,
    Organisation,
    Role,
    RoleGroup,
    RoleGroupPermissionGroup,
    RoleGroupRole,
    RolePermission,
    RolePermissionGroup,
    TeamMember,
    TeamRole,
    TeamRoleGroup,
    User,
    UserRole,
    UserRoleGroup,
    UserOrganisation,
)
from .security import decode_token

bearer = HTTPBearer(auto_error=True)


def get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    try:
        payload = decode_token(creds.credentials)
        if payload.get("type") != "access":
            raise ValueError("wrong token type")
        user = db.get(User, payload["sub"])
    except Exception:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Jeton invalide")
    if not user or user.statut == "disabled":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Utilisateur inconnu ou désactivé")
    return user


def _descendant_ids(db: Session, roots: set[str]) -> set[str]:
    if not roots:
        return set()
    rows = db.execute(select(Organisation.id, Organisation.parent_id)).all()
    descendants = set(roots)
    changed = True
    while changed:
        changed = False
        for org_id, parent_id in rows:
            if parent_id in descendants and org_id not in descendants:
                descendants.add(org_id)
                changed = True
    return descendants


def _scope_matches(db: Session, scope_type: str, scope_id: str | None,
                   active_org_id: str | None) -> bool:
    if scope_type == "all":
        return True
    if scope_type == "org" and scope_id and active_org_id:
        return active_org_id in _descendant_ids(db, {scope_id})
    return False


def compute_permissions(
    db: Session, user: User, active_org_id: str | None = None
) -> dict[str, list[str]]:
    """Fusionne les permissions de tous les rôles de l'utilisateur -> {code: actions}."""
    if user.is_superadmin:
        return {f.code: list(f.actions) for f in db.execute(select(Feature)).scalars()}

    role_ids, role_group_ids = _effective_role_ids(db, user, active_org_id)
    return permissions_des_roles(db, role_ids, role_group_ids)


def permissions_des_roles(
    db: Session, role_ids: set[str], role_group_ids: set[str]
) -> dict[str, list[str]]:
    """Permissions portees par un jeu de roles, independamment de tout porteur.

    Extrait de `compute_permissions` pour pouvoir repondre a une autre question
    que « que peut cet utilisateur ? » : « que conferrerait ce role ? ». C'est
    ce qu'il faut savoir avant d'autoriser quelqu'un a l'attribuer.
    """
    perms: dict[str, set[str]] = {}
    if role_group_ids:
        # Un groupe de roles confere aussi les roles qu'il contient.
        role_ids = set(role_ids) | set(db.execute(
            select(RoleGroupRole.role_id).where(RoleGroupRole.group_id.in_(role_group_ids))
        ).scalars())

    rows = db.execute(
        select(RolePermission, Feature)
        .join(Feature, Feature.id == RolePermission.feature_id)
        .where(RolePermission.role_id.in_(role_ids))
    ).all() if role_ids else []
    for rp, feature in rows:
        perms.setdefault(feature.code, set()).update(rp.actions or [])

    permission_group_ids: set[str] = set()
    if role_ids:
        permission_group_ids.update(db.execute(
            select(RolePermissionGroup.permission_group_id).where(
                RolePermissionGroup.role_id.in_(role_ids)
            )
        ).scalars())
    if role_group_ids:
        permission_group_ids.update(db.execute(
            select(RoleGroupPermissionGroup.permission_group_id).where(
                RoleGroupPermissionGroup.role_group_id.in_(role_group_ids)
            )
        ).scalars())
    if permission_group_ids:
        group_rows = db.execute(
            select(PermissionGroupPermission, Feature)
            .join(Feature, Feature.id == PermissionGroupPermission.feature_id)
            .where(PermissionGroupPermission.group_id.in_(permission_group_ids))
        ).all()
        for permission, feature in group_rows:
            perms.setdefault(feature.code, set()).update(permission.actions or [])
    return {code: sorted(actions) for code, actions in perms.items()}


def _effective_role_ids(
    db: Session, user: User, active_org_id: str | None
) -> tuple[set[str], set[str]]:
    """Resolve direct and team role assignments for one organisation scope."""
    role_ids = set(ur.role_id for ur in db.execute(
        select(UserRole).where(UserRole.user_id == user.id)
    ).scalars() if _scope_matches(db, ur.scope_type, ur.scope_id, active_org_id))
    role_group_ids = set(row.role_group_id for row in db.execute(
        select(UserRoleGroup).where(UserRoleGroup.user_id == user.id)
    ).scalars() if _scope_matches(db, row.scope_type, row.scope_id, active_org_id))
    team_ids = set(db.execute(
        select(TeamMember.team_id).where(TeamMember.user_id == user.id)
    ).scalars())
    if team_ids:
        scoped_team_roles = db.execute(
            select(TeamRole).where(TeamRole.team_id.in_(team_ids))
        ).scalars()
        role_ids.update(
            row.role_id for row in scoped_team_roles
            if _scope_matches(db, row.scope_type, row.scope_id, active_org_id)
        )
        scoped_team_groups = db.execute(
            select(TeamRoleGroup).where(TeamRoleGroup.team_id.in_(team_ids))
        ).scalars()
        role_group_ids.update(
            row.role_group_id for row in scoped_team_groups
            if _scope_matches(db, row.scope_type, row.scope_id, active_org_id)
        )
    if role_group_ids:
        role_ids.update(db.execute(
            select(RoleGroupRole.role_id).where(RoleGroupRole.group_id.in_(role_group_ids))
        ).scalars())
    return role_ids, role_group_ids


def compute_role_names(db: Session, user: User, active_org_id: str | None) -> list[str]:
    """Return the effective role labels shown by the organisation switcher."""
    if user.is_superadmin:
        return ["Super administrateur"]
    role_ids, role_group_ids = _effective_role_ids(db, user, active_org_id)
    names = set(db.execute(select(Role.nom).where(Role.id.in_(role_ids))).scalars()) if role_ids else set()
    if role_group_ids:
        names.update(db.execute(
            select(RoleGroup.nom).where(RoleGroup.id.in_(role_group_ids))
        ).scalars())
    return sorted(names, key=str.casefold)


def accessible_organisation_ids(db: Session, user: User) -> set[str] | None:
    """Return the user's organisations and every descendant; None means unrestricted."""
    if user.is_superadmin:
        return None
    roots = set(db.execute(
        select(UserOrganisation.org_id).where(UserOrganisation.user_id == user.id)
    ).scalars())
    if user.org_id:
        roots.add(user.org_id)
    if not roots:
        return set()
    return _descendant_ids(db, roots)


def resolve_active_organisation_id(
    request: Request, db: Session, user: User
) -> str | None:
    """Validate and resolve the organisation carried by the current request."""
    requested = request.headers.get("X-Organization-ID")
    allowed = accessible_organisation_ids(db, user)
    if requested == "*":
        if not user.is_superadmin:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Vue globale non autorisée")
        return None
    if requested:
        if not db.get(Organisation, requested):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Organisation inconnue")
        if allowed is not None and requested not in allowed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Organisation non autorisée")
        return requested
    if user.org_id and (allowed is None or user.org_id in allowed):
        return user.org_id
    if allowed:
        return sorted(allowed)[0]
    return None


def request_organisation_id(request: Request) -> str | None:
    return getattr(request.state, "active_org_id", None)


def sans_perimetre(request: Request) -> bool:
    """True quand la requete n'a aucune organisation active sans y avoir droit.

    L'organisation active vaut None dans deux situations tres differentes : la
    vue globale d'un super administrateur, et un compte non superadmin rattache
    a aucune organisation. Confondre les deux transforme « aucun perimetre » en
    « tous les perimetres », ce qui est l'inverse de l'intention.
    """
    if request_organisation_id(request):
        return False
    acteur = getattr(request.state, "actor", None)
    return not (acteur is not None and acteur.is_superadmin)


def verifier_perimetre(request: Request, org_id: str | None, message: str) -> None:
    """Refuse une ressource qui n'appartient pas a l'organisation active.

    `require()` a deja repondu « a-t-il le droit ? ». Cette fonction repond a
    l'autre question, celle qui fait l'etancheite entre locataires : « sur quoi
    ? ». Sans elle, un administrateur d'organisation garde ses permissions
    completes sur les ressources d'une organisation voisine des lors qu'il
    connait un identifiant.

    Le refus est un 404 et non un 403 : repondre « interdit » confirmerait
    l'existence de la ressource, donc renseignerait un locataire sur ses
    voisins. L'organisation active vaut None dans un seul cas, la vue globale,
    reservee au superadmin par `resolve_active_organisation_id`.
    """
    actif = request_organisation_id(request)
    if actif is None:
        if sans_perimetre(request):
            raise HTTPException(status.HTTP_404_NOT_FOUND, message)
        return  # vue globale d'un super administrateur
    if org_id != actif:
        raise HTTPException(status.HTTP_404_NOT_FOUND, message)


def require(feature_code: str, action: str = "view"):
    """Dependency FastAPI : impose une feature `api:*` + action (403 sinon)."""

    def _dep(request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
        active_org_id = resolve_active_organisation_id(request, db, user)
        perms = compute_permissions(db, user, active_org_id)
        if action not in perms.get(feature_code, []):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"Permission manquante : {feature_code}:{action}",
            )
        request.state.actor = user
        request.state.active_org_id = active_org_id
        # Depose sur la session ce que `write_audit` estampillera. Passer par
        # `Session.info` evite d'ajouter un parametre a soixante-dix appels.
        db.info["active_org_id"] = active_org_id
        return user

    return _dep


def verifier_hierarchie(acteur: User, cible: User, message: str) -> None:
    """Interdit a un non-superadmin d'agir sur un compte de super administrateur.

    Sans cette regle, il suffit qu'un super administrateur soit rattache a une
    organisation pour que l'administrateur de cette organisation en devienne le
    gestionnaire : il peut lui retirer ses roles, le deplacer, le supprimer.
    La hierarchie s'inverse. Le refus est un 404, comme l'absence de ce compte
    dans les listes servies aux locataires : les deux doivent raconter la meme
    histoire.
    """
    if cible.is_superadmin and not acteur.is_superadmin:
        raise HTTPException(status.HTTP_404_NOT_FOUND, message)


def roles_hors_portee(
    db: Session, acteur: User, active_org_id: str | None, role_ids, role_group_ids=()
) -> list[str]:
    """Roles qui confereraient plus que ce que l'acteur detient lui-meme.

    Sans ce controle, un administrateur borne attribue n'importe quel role, donc
    se fabrique un complice plus puissant que lui — et, en deux etapes, se
    promeut lui-meme.
    """
    if acteur.is_superadmin:
        return []
    miennes = compute_permissions(db, acteur, active_org_id)
    excessifs: list[str] = []
    for identifiant in list(role_ids) + list(role_group_ids):
        est_groupe = identifiant in set(role_group_ids)
        conferees = permissions_des_roles(
            db,
            set() if est_groupe else {identifiant},
            {identifiant} if est_groupe else set(),
        )
        for code, actions in conferees.items():
            if not set(actions) <= set(miennes.get(code, [])):
                excessifs.append(identifiant)
                break
    return excessifs


def write_audit(
    db: Session,
    *,
    actor: User | None,
    action: str,
    resource: str | None = None,
    result: str = "success",
    ip: str | None = None,
    org_id: str | None = None,
) -> None:
    db.add(
        AuditLog(
            actor_id=actor.id if actor else None,
            actor_label=(f"{actor.nom}" if actor else "system"),
            org_id=org_id if org_id is not None else db.info.get("active_org_id"),
            action=action,
            resource=resource,
            result=result,
            ip=ip,
        )
    )
    db.commit()
