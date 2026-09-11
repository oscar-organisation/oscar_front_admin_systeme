from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..deps import request_organisation_id, require, write_audit
from ..models import (
    Feature,
    Fleet,
    FleetRobot,
    Organisation,
    OrganisationCategory,
    PermissionGroup,
    PermissionGroupPermission,
    Robot,
    Role,
    RoleGroup,
    RoleGroupPermissionGroup,
    RoleGroupRole,
    Team,
    TeamMember,
    TeamOrganisation,
    TeamRole,
    TeamRoleGroup,
    User,
)
from ..schemas import (
    FleetIn,
    FleetOut,
    OrganisationCategoryIn,
    OrganisationCategoryOut,
    PermissionGroupIn,
    PermissionGroupOut,
    RoleGroupIn,
    RoleGroupOut,
    TeamIn,
    TeamAccessIn,
    TeamMemberOut,
    TeamMembersIn,
    TeamOut,
)

router = APIRouter(tags=["structure-iam"])


def _commit(db: Session, conflict: str) -> None:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, conflict)


def _team_out(team: Team) -> TeamOut:
    return TeamOut(
        id=team.id,
        nom=team.nom,
        description=team.description,
        statut=team.statut,
        org_ids=[link.org_id for link in team.organisations],
        members=[
            TeamMemberOut(
                user_id=member.user_id,
                nom=member.user.nom,
                email=member.user.email,
                title=member.title,
            )
            for member in team.members
        ],
        role_ids=[assignment.role_id for assignment in team.roles],
        role_group_ids=[assignment.role_group_id for assignment in team.role_groups],
    )


def _permission_group_out(group: PermissionGroup) -> PermissionGroupOut:
    return PermissionGroupOut(
        id=group.id,
        nom=group.nom,
        description=group.description,
        org_id=group.org_id,
        visibility=group.visibility,
        permissions=[
            {"feature_code": permission.feature.code, "actions": permission.actions}
            for permission in group.permissions
        ],
    )


def _role_group_out(group: RoleGroup) -> RoleGroupOut:
    return RoleGroupOut(
        id=group.id,
        nom=group.nom,
        description=group.description,
        org_id=group.org_id,
        visibility=group.visibility,
        role_ids=[link.role_id for link in group.roles],
        permission_group_ids=[link.permission_group_id for link in group.permission_groups],
    )


def _fleet_out(fleet: Fleet) -> FleetOut:
    return FleetOut(
        id=fleet.id,
        org_id=fleet.org_id,
        nom=fleet.nom,
        code=fleet.code,
        description=fleet.description,
        robot_ids=[link.robot_id for link in fleet.robots],
    )


@router.get("/organisation-categories", response_model=list[OrganisationCategoryOut])
def list_organisation_categories(
    db: Session = Depends(get_db), _=Depends(require("api:iam.structure.read"))
):
    return db.execute(
        select(OrganisationCategory).order_by(OrganisationCategory.nom)
    ).scalars().all()


@router.post("/organisation-categories", response_model=OrganisationCategoryOut, status_code=201)
def create_organisation_category(
    body: OrganisationCategoryIn,
    db: Session = Depends(get_db),
    user=Depends(require("api:iam.structure.write", "create")),
):
    category = OrganisationCategory(**body.model_dump())
    db.add(category)
    _commit(db, "Ce code de catégorie existe déjà")
    db.refresh(category)
    write_audit(db, actor=user, action="ORG_CATEGORY_CREATE", resource=category.nom)
    return category


@router.patch("/organisation-categories/{category_id}", response_model=OrganisationCategoryOut)
def update_organisation_category(
    category_id: str,
    body: OrganisationCategoryIn,
    db: Session = Depends(get_db),
    user=Depends(require("api:iam.structure.write", "update")),
):
    category = db.get(OrganisationCategory, category_id)
    if not category:
        raise HTTPException(404, "Catégorie introuvable")
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(category, key, value)
    _commit(db, "Ce code de catégorie existe déjà")
    db.refresh(category)
    write_audit(db, actor=user, action="ORG_CATEGORY_UPDATE", resource=category.nom)
    return category


@router.delete("/organisation-categories/{category_id}", status_code=204)
def delete_organisation_category(
    category_id: str,
    db: Session = Depends(get_db),
    user=Depends(require("api:iam.structure.write", "delete")),
):
    category = db.get(OrganisationCategory, category_id)
    if not category:
        raise HTTPException(404, "Catégorie introuvable")
    db.delete(category)
    db.commit()
    write_audit(db, actor=user, action="ORG_CATEGORY_DELETE", resource=category.nom)


def _load_team(db: Session, team_id: str) -> Team | None:
    return db.execute(
        select(Team)
        .where(Team.id == team_id)
        .options(
            selectinload(Team.organisations),
            selectinload(Team.members).selectinload(TeamMember.user),
            selectinload(Team.roles),
            selectinload(Team.role_groups),
        )
    ).scalar_one_or_none()


@router.get("/teams", response_model=list[TeamOut])
def list_teams(request: Request, db: Session = Depends(get_db),
               _=Depends(require("api:iam.structure.read"))):
    query = (
        select(Team)
        .options(
            selectinload(Team.organisations),
            selectinload(Team.members).selectinload(TeamMember.user),
            selectinload(Team.roles),
            selectinload(Team.role_groups),
        )
        .order_by(Team.nom)
    )
    scoped_org_id = request_organisation_id(request)
    if scoped_org_id:
        query = query.join(TeamOrganisation).where(
            TeamOrganisation.org_id == scoped_org_id
        ).distinct()
    teams = db.execute(query).scalars().all()
    return [_team_out(team) for team in teams]


def _sync_team_orgs(db: Session, team: Team, org_ids: list[str]) -> None:
    valid_ids = set(db.execute(select(Organisation.id).where(Organisation.id.in_(org_ids))).scalars())
    if valid_ids != set(org_ids):
        raise HTTPException(400, "Une organisation sélectionnée est inconnue")
    for assignment in list(team.organisations):
        db.delete(assignment)
    db.flush()
    for org_id in org_ids:
        team.organisations.append(TeamOrganisation(org_id=org_id))


@router.post("/teams", response_model=TeamOut, status_code=201)
def create_team(
    body: TeamIn,
    db: Session = Depends(get_db),
    user=Depends(require("api:iam.structure.write", "create")),
):
    team = Team(nom=body.nom, description=body.description, statut=body.statut)
    db.add(team)
    _sync_team_orgs(db, team, body.org_ids)
    db.commit()
    team = _load_team(db, team.id)
    write_audit(db, actor=user, action="TEAM_CREATE", resource=team.nom)
    return _team_out(team)


@router.patch("/teams/{team_id}", response_model=TeamOut)
def update_team(
    team_id: str,
    body: TeamIn,
    db: Session = Depends(get_db),
    user=Depends(require("api:iam.structure.write", "update")),
):
    team = _load_team(db, team_id)
    if not team:
        raise HTTPException(404, "Équipe introuvable")
    team.nom, team.description, team.statut = body.nom, body.description, body.statut
    _sync_team_orgs(db, team, body.org_ids)
    db.commit()
    team = _load_team(db, team_id)
    write_audit(db, actor=user, action="TEAM_UPDATE", resource=team.nom)
    return _team_out(team)


@router.put("/teams/{team_id}/members", response_model=TeamOut)
def set_team_members(
    team_id: str,
    body: TeamMembersIn,
    db: Session = Depends(get_db),
    user=Depends(require("api:iam.structure.write", "update")),
):
    team = _load_team(db, team_id)
    if not team:
        raise HTTPException(404, "Équipe introuvable")
    valid_ids = set(db.execute(select(User.id).where(User.id.in_(body.user_ids))).scalars())
    if valid_ids != set(body.user_ids):
        raise HTTPException(400, "Un utilisateur sélectionné est inconnu")
    for member in list(team.members):
        db.delete(member)
    db.flush()
    for user_id in body.user_ids:
        team.members.append(TeamMember(user_id=user_id))
    db.commit()
    team = _load_team(db, team_id)
    write_audit(db, actor=user, action="TEAM_MEMBERS_SET", resource=team.nom)
    return _team_out(team)


@router.put("/teams/{team_id}/access", response_model=TeamOut)
def set_team_access(
    team_id: str,
    body: TeamAccessIn,
    db: Session = Depends(get_db),
    user=Depends(require("api:iam.structure.write", "update")),
):
    team = _load_team(db, team_id)
    if not team:
        raise HTTPException(404, "Équipe introuvable")
    role_ids = list(dict.fromkeys(body.role_ids))
    group_ids = list(dict.fromkeys(body.role_group_ids))
    valid_roles = set(
        db.execute(select(Role.id).where(Role.id.in_(role_ids))).scalars()
    ) if role_ids else set()
    valid_groups = set(
        db.execute(select(RoleGroup.id).where(RoleGroup.id.in_(group_ids))).scalars()
    ) if group_ids else set()
    if valid_roles != set(role_ids) or valid_groups != set(group_ids):
        raise HTTPException(400, "Un rôle ou groupe de rôles sélectionné est inconnu")
    for assignment in [*team.roles, *team.role_groups]:
        db.delete(assignment)
    db.flush()
    for role_id in role_ids:
        team.roles.append(TeamRole(
            role_id=role_id, scope_type=body.scope_type, scope_id=body.scope_id
        ))
    for group_id in group_ids:
        team.role_groups.append(TeamRoleGroup(
            role_group_id=group_id, scope_type=body.scope_type, scope_id=body.scope_id
        ))
    db.commit()
    team = _load_team(db, team_id)
    write_audit(db, actor=user, action="TEAM_ACCESS_SET", resource=team.nom)
    return _team_out(team)


@router.delete("/teams/{team_id}", status_code=204)
def delete_team(
    team_id: str,
    db: Session = Depends(get_db),
    user=Depends(require("api:iam.structure.write", "delete")),
):
    team = db.get(Team, team_id)
    if not team:
        raise HTTPException(404, "Équipe introuvable")
    db.delete(team)
    db.commit()
    write_audit(db, actor=user, action="TEAM_DELETE", resource=team.nom)


def _set_group_permissions(db: Session, group: PermissionGroup, body: PermissionGroupIn) -> None:
    features = {item.code: item for item in db.execute(select(Feature)).scalars()}
    for permission in list(group.permissions):
        db.delete(permission)
    db.flush()
    for item in body.permissions:
        feature = features.get(item.feature_code)
        if not feature:
            raise HTTPException(400, f"Fonctionnalité inconnue : {item.feature_code}")
        actions = [action for action in item.actions if action in (feature.actions or [])]
        if actions:
            group.permissions.append(PermissionGroupPermission(feature_id=feature.id, actions=actions))


def _load_permission_group(db: Session, group_id: str) -> PermissionGroup | None:
    return db.execute(
        select(PermissionGroup)
        .where(PermissionGroup.id == group_id)
        .options(selectinload(PermissionGroup.permissions).selectinload(PermissionGroupPermission.feature))
    ).scalar_one_or_none()


@router.get("/permission-groups", response_model=list[PermissionGroupOut])
def list_permission_groups(
    request: Request, db: Session = Depends(get_db),
    _=Depends(require("api:iam.structure.read"))
):
    query = (
        select(PermissionGroup)
        .options(selectinload(PermissionGroup.permissions).selectinload(PermissionGroupPermission.feature))
        .order_by(PermissionGroup.nom)
    )
    scoped_org_id = request_organisation_id(request)
    if scoped_org_id:
        query = query.where(or_(
            PermissionGroup.visibility == "public",
            PermissionGroup.org_id == scoped_org_id,
        ))
    groups = db.execute(query).scalars().all()
    return [_permission_group_out(group) for group in groups]


@router.post("/permission-groups", response_model=PermissionGroupOut, status_code=201)
def create_permission_group(
    body: PermissionGroupIn,
    db: Session = Depends(get_db),
    user=Depends(require("api:iam.structure.write", "create")),
):
    group = PermissionGroup(
        nom=body.nom, description=body.description, org_id=body.org_id, visibility=body.visibility
    )
    db.add(group)
    _set_group_permissions(db, group, body)
    db.commit()
    group = _load_permission_group(db, group.id)
    write_audit(db, actor=user, action="PERMISSION_GROUP_CREATE", resource=group.nom)
    return _permission_group_out(group)


@router.patch("/permission-groups/{group_id}", response_model=PermissionGroupOut)
def update_permission_group(
    group_id: str,
    body: PermissionGroupIn,
    db: Session = Depends(get_db),
    user=Depends(require("api:iam.structure.write", "update")),
):
    group = _load_permission_group(db, group_id)
    if not group:
        raise HTTPException(404, "Groupe de permissions introuvable")
    group.nom, group.description = body.nom, body.description
    group.org_id, group.visibility = body.org_id, body.visibility
    _set_group_permissions(db, group, body)
    db.commit()
    group = _load_permission_group(db, group_id)
    write_audit(db, actor=user, action="PERMISSION_GROUP_UPDATE", resource=group.nom)
    return _permission_group_out(group)


@router.delete("/permission-groups/{group_id}", status_code=204)
def delete_permission_group(
    group_id: str,
    db: Session = Depends(get_db),
    user=Depends(require("api:iam.structure.write", "delete")),
):
    group = db.get(PermissionGroup, group_id)
    if not group:
        raise HTTPException(404, "Groupe de permissions introuvable")
    db.delete(group)
    db.commit()
    write_audit(db, actor=user, action="PERMISSION_GROUP_DELETE", resource=group.nom)


def _set_group_roles(db: Session, group: RoleGroup, role_ids: list[str]) -> None:
    valid_ids = set(db.execute(select(Role.id).where(Role.id.in_(role_ids))).scalars())
    if valid_ids != set(role_ids):
        raise HTTPException(400, "Un rôle sélectionné est inconnu")
    for assignment in list(group.roles):
        db.delete(assignment)
    db.flush()
    for role_id in role_ids:
        group.roles.append(RoleGroupRole(role_id=role_id))


def _set_role_group_permission_groups(
    db: Session, group: RoleGroup, permission_group_ids: list[str]
) -> None:
    valid_ids = set(
        db.execute(
            select(PermissionGroup.id).where(PermissionGroup.id.in_(permission_group_ids))
        ).scalars()
    ) if permission_group_ids else set()
    if valid_ids != set(permission_group_ids):
        raise HTTPException(400, "Un groupe de permissions sélectionné est inconnu")
    for assignment in list(group.permission_groups):
        db.delete(assignment)
    db.flush()
    for permission_group_id in permission_group_ids:
        group.permission_groups.append(
            RoleGroupPermissionGroup(permission_group_id=permission_group_id)
        )


def _load_role_group(db: Session, group_id: str) -> RoleGroup | None:
    return db.execute(
        select(RoleGroup).where(RoleGroup.id == group_id).options(
            selectinload(RoleGroup.roles), selectinload(RoleGroup.permission_groups)
        )
    ).scalar_one_or_none()


@router.get("/role-groups", response_model=list[RoleGroupOut])
def list_role_groups(request: Request, db: Session = Depends(get_db),
                     _=Depends(require("api:iam.structure.read"))):
    query = select(RoleGroup).options(
            selectinload(RoleGroup.roles), selectinload(RoleGroup.permission_groups)
        ).order_by(RoleGroup.nom)
    scoped_org_id = request_organisation_id(request)
    if scoped_org_id:
        query = query.where(or_(
            RoleGroup.visibility == "public",
            RoleGroup.org_id == scoped_org_id,
        ))
    groups = db.execute(query).scalars().all()
    return [_role_group_out(group) for group in groups]


@router.post("/role-groups", response_model=RoleGroupOut, status_code=201)
def create_role_group(
    body: RoleGroupIn,
    db: Session = Depends(get_db),
    user=Depends(require("api:iam.structure.write", "create")),
):
    group = RoleGroup(
        nom=body.nom, description=body.description, org_id=body.org_id, visibility=body.visibility
    )
    db.add(group)
    _set_group_roles(db, group, body.role_ids)
    _set_role_group_permission_groups(db, group, body.permission_group_ids)
    db.commit()
    group = _load_role_group(db, group.id)
    write_audit(db, actor=user, action="ROLE_GROUP_CREATE", resource=group.nom)
    return _role_group_out(group)


@router.patch("/role-groups/{group_id}", response_model=RoleGroupOut)
def update_role_group(
    group_id: str,
    body: RoleGroupIn,
    db: Session = Depends(get_db),
    user=Depends(require("api:iam.structure.write", "update")),
):
    group = _load_role_group(db, group_id)
    if not group:
        raise HTTPException(404, "Groupe de rôles introuvable")
    group.nom, group.description = body.nom, body.description
    group.org_id, group.visibility = body.org_id, body.visibility
    _set_group_roles(db, group, body.role_ids)
    _set_role_group_permission_groups(db, group, body.permission_group_ids)
    db.commit()
    group = _load_role_group(db, group_id)
    write_audit(db, actor=user, action="ROLE_GROUP_UPDATE", resource=group.nom)
    return _role_group_out(group)


@router.delete("/role-groups/{group_id}", status_code=204)
def delete_role_group(
    group_id: str,
    db: Session = Depends(get_db),
    user=Depends(require("api:iam.structure.write", "delete")),
):
    group = db.get(RoleGroup, group_id)
    if not group:
        raise HTTPException(404, "Groupe de rôles introuvable")
    db.delete(group)
    db.commit()
    write_audit(db, actor=user, action="ROLE_GROUP_DELETE", resource=group.nom)


def _sync_fleet_robots(db: Session, fleet: Fleet, robot_ids: list[str]) -> None:
    valid_ids = set(db.execute(select(Robot.id).where(Robot.id.in_(robot_ids))).scalars())
    if valid_ids != set(robot_ids):
        raise HTTPException(400, "Un robot sélectionné est inconnu")
    for assignment in list(fleet.robots):
        db.delete(assignment)
    db.flush()
    for robot_id in robot_ids:
        fleet.robots.append(FleetRobot(robot_id=robot_id))


def _load_fleet(db: Session, fleet_id: str) -> Fleet | None:
    return db.execute(
        select(Fleet).where(Fleet.id == fleet_id).options(selectinload(Fleet.robots))
    ).scalar_one_or_none()


@router.get("/fleets", response_model=list[FleetOut])
def list_fleets(request: Request, db: Session = Depends(get_db),
                _=Depends(require("api:robot.read"))):
    query = select(Fleet).options(selectinload(Fleet.robots)).order_by(Fleet.nom)
    scoped_org_id = request_organisation_id(request)
    if scoped_org_id:
        query = query.where(Fleet.org_id == scoped_org_id)
    fleets = db.execute(query).scalars().all()
    return [_fleet_out(fleet) for fleet in fleets]


@router.post("/fleets", response_model=FleetOut, status_code=201)
def create_fleet(
    body: FleetIn,
    db: Session = Depends(get_db),
    user=Depends(require("api:robot.write", "create")),
):
    fleet = Fleet(org_id=body.org_id, nom=body.nom, code=body.code, description=body.description)
    db.add(fleet)
    _sync_fleet_robots(db, fleet, body.robot_ids)
    _commit(db, "Ce code de flotte existe déjà dans cette organisation")
    fleet = _load_fleet(db, fleet.id)
    write_audit(db, actor=user, action="FLEET_CREATE", resource=fleet.nom)
    return _fleet_out(fleet)


@router.patch("/fleets/{fleet_id}", response_model=FleetOut)
def update_fleet(
    fleet_id: str,
    body: FleetIn,
    db: Session = Depends(get_db),
    user=Depends(require("api:robot.write", "update")),
):
    fleet = _load_fleet(db, fleet_id)
    if not fleet:
        raise HTTPException(404, "Flotte introuvable")
    fleet.org_id, fleet.nom, fleet.code = body.org_id, body.nom, body.code
    fleet.description = body.description
    _sync_fleet_robots(db, fleet, body.robot_ids)
    _commit(db, "Ce code de flotte existe déjà dans cette organisation")
    fleet = _load_fleet(db, fleet_id)
    write_audit(db, actor=user, action="FLEET_UPDATE", resource=fleet.nom)
    return _fleet_out(fleet)


@router.delete("/fleets/{fleet_id}", status_code=204)
def delete_fleet(
    fleet_id: str,
    db: Session = Depends(get_db),
    user=Depends(require("api:robot.write", "delete")),
):
    fleet = db.get(Fleet, fleet_id)
    if not fleet:
        raise HTTPException(404, "Flotte introuvable")
    db.delete(fleet)
    db.commit()
    write_audit(db, actor=user, action="FLEET_DELETE", resource=fleet.nom)
