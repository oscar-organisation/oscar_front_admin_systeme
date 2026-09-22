import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def _uuid() -> str:
    return uuid.uuid4().hex


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


# --------------------------------------------------------------------------- #
#  Organisations & Sites
# --------------------------------------------------------------------------- #
class Organisation(Base, TimestampMixin):
    __tablename__ = "organisations"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    nom: Mapped[str] = mapped_column(String(160), nullable=False)
    slug: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    contact: Mapped[str | None] = mapped_column(String(160))
    statut: Mapped[str] = mapped_column(String(20), default="active")  # active|suspended
    category_id: Mapped[str | None] = mapped_column(
        ForeignKey("organisation_categories.id", ondelete="SET NULL")
    )
    parent_id: Mapped[str | None] = mapped_column(
        ForeignKey("organisations.id", ondelete="SET NULL")
    )

    sites: Mapped[list["Site"]] = relationship(back_populates="organisation", cascade="all, delete-orphan")
    category: Mapped["OrganisationCategory | None"] = relationship(back_populates="organisations")
    parent: Mapped["Organisation | None"] = relationship(
        remote_side="Organisation.id", back_populates="children"
    )
    children: Mapped[list["Organisation"]] = relationship(back_populates="parent")


class OrganisationCategory(Base, TimestampMixin):
    __tablename__ = "organisation_categories"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    code: Mapped[str] = mapped_column(String(60), unique=True, nullable=False, index=True)
    nom: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)

    organisations: Mapped[list[Organisation]] = relationship(back_populates="category")


class Site(Base, TimestampMixin):
    __tablename__ = "sites"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organisations.id", ondelete="CASCADE"))
    nom: Mapped[str] = mapped_column(String(160), nullable=False)
    code: Mapped[str] = mapped_column(String(40), nullable=False)  # ex FR-PAR-001
    adresse: Mapped[str | None] = mapped_column(String(240))
    zones: Mapped[list] = mapped_column(JSON, default=list)
    statut: Mapped[str] = mapped_column(String(20), default="operational")  # operational|tests|offline

    organisation: Mapped[Organisation] = relationship(back_populates="sites")


# --------------------------------------------------------------------------- #
#  Utilisateurs, rôles, permissions (RBAC)
# --------------------------------------------------------------------------- #
class User(Base, TimestampMixin):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    org_id: Mapped[str | None] = mapped_column(ForeignKey("organisations.id", ondelete="SET NULL"))
    email: Mapped[str] = mapped_column(String(200), unique=True, nullable=False, index=True)
    nom: Mapped[str] = mapped_column(String(160), nullable=False)
    password_hash: Mapped[str | None] = mapped_column(String(255))
    statut: Mapped[str] = mapped_column(String(20), default="invited")  # active|invited|disabled
    is_superadmin: Mapped[bool] = mapped_column(Boolean, default=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    roles: Mapped[list["UserRole"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    organisation_memberships: Mapped[list["UserOrganisation"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    team_memberships: Mapped[list["TeamMember"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    role_groups: Mapped[list["UserRoleGroup"]] = relationship(
        cascade="all, delete-orphan"
    )


class UserOrganisation(Base, TimestampMixin):
    __tablename__ = "user_organisations"
    __table_args__ = (UniqueConstraint("user_id", "org_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    org_id: Mapped[str] = mapped_column(ForeignKey("organisations.id", ondelete="CASCADE"))
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False)

    user: Mapped[User] = relationship(back_populates="organisation_memberships")
    organisation: Mapped[Organisation] = relationship()


class Team(Base, TimestampMixin):
    __tablename__ = "teams"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    nom: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    statut: Mapped[str] = mapped_column(String(20), default="active")

    members: Mapped[list["TeamMember"]] = relationship(
        back_populates="team", cascade="all, delete-orphan"
    )
    organisations: Mapped[list["TeamOrganisation"]] = relationship(
        back_populates="team", cascade="all, delete-orphan"
    )
    roles: Mapped[list["TeamRole"]] = relationship(
        back_populates="team", cascade="all, delete-orphan"
    )
    role_groups: Mapped[list["TeamRoleGroup"]] = relationship(
        cascade="all, delete-orphan"
    )


class TeamMember(Base, TimestampMixin):
    __tablename__ = "team_members"
    __table_args__ = (UniqueConstraint("team_id", "user_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    title: Mapped[str | None] = mapped_column(String(80))

    team: Mapped[Team] = relationship(back_populates="members")
    user: Mapped[User] = relationship(back_populates="team_memberships")


class TeamOrganisation(Base):
    __tablename__ = "team_organisations"
    __table_args__ = (UniqueConstraint("team_id", "org_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"))
    org_id: Mapped[str] = mapped_column(ForeignKey("organisations.id", ondelete="CASCADE"))

    team: Mapped[Team] = relationship(back_populates="organisations")
    organisation: Mapped[Organisation] = relationship()


class Feature(Base):
    __tablename__ = "features"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    code: Mapped[str] = mapped_column(String(80), unique=True, nullable=False, index=True)
    label: Mapped[str] = mapped_column(String(160), nullable=False)
    type: Mapped[str] = mapped_column(String(10), nullable=False)  # api|ui
    module: Mapped[str] = mapped_column(String(40), nullable=False)
    actions: Mapped[list] = mapped_column(JSON, default=list)


class Role(Base, TimestampMixin):
    __tablename__ = "roles"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    org_id: Mapped[str | None] = mapped_column(ForeignKey("organisations.id", ondelete="CASCADE"))
    nom: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)
    visibility: Mapped[str] = mapped_column(String(20), default="private")  # public|private

    permissions: Mapped[list["RolePermission"]] = relationship(
        back_populates="role", cascade="all, delete-orphan"
    )
    permission_groups: Mapped[list["RolePermissionGroup"]] = relationship(
        back_populates="role", cascade="all, delete-orphan"
    )


class RolePermission(Base):
    __tablename__ = "role_permissions"
    __table_args__ = (UniqueConstraint("role_id", "feature_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    role_id: Mapped[str] = mapped_column(ForeignKey("roles.id", ondelete="CASCADE"))
    feature_id: Mapped[str] = mapped_column(ForeignKey("features.id", ondelete="CASCADE"))
    actions: Mapped[list] = mapped_column(JSON, default=list)

    role: Mapped[Role] = relationship(back_populates="permissions")
    feature: Mapped[Feature] = relationship()


class UserRole(Base):
    __tablename__ = "user_roles"
    __table_args__ = (UniqueConstraint("user_id", "role_id", "scope_type", "scope_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    role_id: Mapped[str] = mapped_column(ForeignKey("roles.id", ondelete="CASCADE"))
    scope_type: Mapped[str] = mapped_column(String(10), default="all")  # all|org|site
    scope_id: Mapped[str | None] = mapped_column(String(32))

    user: Mapped[User] = relationship(back_populates="roles")
    role: Mapped[Role] = relationship()


class PermissionGroup(Base, TimestampMixin):
    __tablename__ = "permission_groups"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    org_id: Mapped[str | None] = mapped_column(ForeignKey("organisations.id", ondelete="CASCADE"))
    nom: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    visibility: Mapped[str] = mapped_column(String(20), default="private")

    permissions: Mapped[list["PermissionGroupPermission"]] = relationship(
        back_populates="group", cascade="all, delete-orphan"
    )


class RolePermissionGroup(Base):
    __tablename__ = "role_permission_groups"
    __table_args__ = (UniqueConstraint("role_id", "permission_group_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    role_id: Mapped[str] = mapped_column(ForeignKey("roles.id", ondelete="CASCADE"))
    permission_group_id: Mapped[str] = mapped_column(
        ForeignKey("permission_groups.id", ondelete="CASCADE")
    )

    role: Mapped[Role] = relationship(back_populates="permission_groups")
    permission_group: Mapped[PermissionGroup] = relationship()


class PermissionGroupPermission(Base):
    __tablename__ = "permission_group_permissions"
    __table_args__ = (UniqueConstraint("group_id", "feature_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    group_id: Mapped[str] = mapped_column(ForeignKey("permission_groups.id", ondelete="CASCADE"))
    feature_id: Mapped[str] = mapped_column(ForeignKey("features.id", ondelete="CASCADE"))
    actions: Mapped[list] = mapped_column(JSON, default=list)

    group: Mapped[PermissionGroup] = relationship(back_populates="permissions")
    feature: Mapped[Feature] = relationship()


class RoleGroup(Base, TimestampMixin):
    __tablename__ = "role_groups"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    org_id: Mapped[str | None] = mapped_column(ForeignKey("organisations.id", ondelete="CASCADE"))
    nom: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    visibility: Mapped[str] = mapped_column(String(20), default="private")

    roles: Mapped[list["RoleGroupRole"]] = relationship(
        back_populates="group", cascade="all, delete-orphan"
    )
    permission_groups: Mapped[list["RoleGroupPermissionGroup"]] = relationship(
        back_populates="role_group", cascade="all, delete-orphan"
    )


class RoleGroupRole(Base):
    __tablename__ = "role_group_roles"
    __table_args__ = (UniqueConstraint("group_id", "role_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    group_id: Mapped[str] = mapped_column(ForeignKey("role_groups.id", ondelete="CASCADE"))
    role_id: Mapped[str] = mapped_column(ForeignKey("roles.id", ondelete="CASCADE"))

    group: Mapped[RoleGroup] = relationship(back_populates="roles")
    role: Mapped[Role] = relationship()


class RoleGroupPermissionGroup(Base):
    __tablename__ = "role_group_permission_groups"
    __table_args__ = (UniqueConstraint("role_group_id", "permission_group_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    role_group_id: Mapped[str] = mapped_column(ForeignKey("role_groups.id", ondelete="CASCADE"))
    permission_group_id: Mapped[str] = mapped_column(
        ForeignKey("permission_groups.id", ondelete="CASCADE")
    )

    role_group: Mapped[RoleGroup] = relationship(back_populates="permission_groups")
    permission_group: Mapped[PermissionGroup] = relationship()


class UserRoleGroup(Base):
    __tablename__ = "user_role_groups"
    __table_args__ = (UniqueConstraint("user_id", "role_group_id", "scope_type", "scope_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    role_group_id: Mapped[str] = mapped_column(ForeignKey("role_groups.id", ondelete="CASCADE"))
    scope_type: Mapped[str] = mapped_column(String(10), default="all")
    scope_id: Mapped[str | None] = mapped_column(String(32))


class TeamRole(Base):
    __tablename__ = "team_roles"
    __table_args__ = (UniqueConstraint("team_id", "role_id", "scope_type", "scope_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"))
    role_id: Mapped[str] = mapped_column(ForeignKey("roles.id", ondelete="CASCADE"))
    scope_type: Mapped[str] = mapped_column(String(10), default="all")
    scope_id: Mapped[str | None] = mapped_column(String(32))

    team: Mapped[Team] = relationship(back_populates="roles")
    role: Mapped[Role] = relationship()


class TeamRoleGroup(Base):
    __tablename__ = "team_role_groups"
    __table_args__ = (UniqueConstraint("team_id", "role_group_id", "scope_type", "scope_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"))
    role_group_id: Mapped[str] = mapped_column(ForeignKey("role_groups.id", ondelete="CASCADE"))
    scope_type: Mapped[str] = mapped_column(String(10), default="all")
    scope_id: Mapped[str | None] = mapped_column(String(32))


# --------------------------------------------------------------------------- #
#  Robots + associations + jetons LiveKit
# --------------------------------------------------------------------------- #
class Robot(Base, TimestampMixin):
    __tablename__ = "robots"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    org_id: Mapped[str | None] = mapped_column(ForeignKey("organisations.id", ondelete="SET NULL"))
    site_id: Mapped[str | None] = mapped_column(ForeignKey("sites.id", ondelete="SET NULL"))
    nom: Mapped[str] = mapped_column(String(80), nullable=False)  # OSCAR-01
    # Identifiant lisible du robot cote terrain : c'est lui que l'agent embarque
    # porte dans son enrolement et dans ses chemins d'installation, la ou l'UUID
    # reste la cle interne. Deux identites pour deux usages, jamais melangees.
    slug: Mapped[str | None] = mapped_column(String(64), unique=True)
    # Cle d'agent propre a ce robot : on garde l'empreinte, jamais la cle. Une
    # cle partagee par la flotte laisse un robot compromis parler au nom des
    # autres ; ici, chaque robot ne peut plus qu'etre lui-meme.
    # Canal de mise a jour du paquet embarque : un robot temoin passe en
    # « beta » avant que la flotte ne suive.
    edge_channel: Mapped[str] = mapped_column(String(20), default="stable")
    # Derniere version du paquet embarque annoncee par le robot lui-meme : la
    # console n'affiche donc pas ce qu'elle a demande, mais ce qui tourne.
    edge_version: Mapped[str | None] = mapped_column(String(40))
    agent_key_hash: Mapped[str | None] = mapped_column(String(64))
    agent_key_issued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    serial: Mapped[str | None] = mapped_column(String(120), unique=True)
    firmware: Mapped[str | None] = mapped_column(String(40))
    statut: Mapped[str] = mapped_column(String(20), default="offline")  # online|offline|maintenance
    batterie: Mapped[int | None] = mapped_column(Integer)
    capacites: Mapped[list] = mapped_column(JSON, default=list)

    assignments: Mapped[list["RobotAssignment"]] = relationship(
        back_populates="robot", cascade="all, delete-orphan"
    )
    tokens: Mapped[list["LiveKitToken"]] = relationship(
        back_populates="robot", cascade="all, delete-orphan"
    )


class Fleet(Base, TimestampMixin):
    __tablename__ = "fleets"
    __table_args__ = (UniqueConstraint("org_id", "code"),)
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organisations.id", ondelete="CASCADE"))
    nom: Mapped[str] = mapped_column(String(120), nullable=False)
    code: Mapped[str] = mapped_column(String(60), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)

    robots: Mapped[list["FleetRobot"]] = relationship(
        back_populates="fleet", cascade="all, delete-orphan"
    )


class FleetRobot(Base):
    __tablename__ = "fleet_robots"
    __table_args__ = (UniqueConstraint("fleet_id", "robot_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    fleet_id: Mapped[str] = mapped_column(ForeignKey("fleets.id", ondelete="CASCADE"))
    robot_id: Mapped[str] = mapped_column(ForeignKey("robots.id", ondelete="CASCADE"))

    fleet: Mapped[Fleet] = relationship(back_populates="robots")
    robot: Mapped[Robot] = relationship()


class RobotAssignment(Base):
    __tablename__ = "robot_assignments"
    __table_args__ = (UniqueConstraint("robot_id", "user_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    robot_id: Mapped[str] = mapped_column(ForeignKey("robots.id", ondelete="CASCADE"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    op_role: Mapped[str] = mapped_column(String(20), default="pilote")  # pilote|superviseur

    robot: Mapped[Robot] = relationship(back_populates="assignments")
    user: Mapped[User] = relationship()


class LiveKitToken(Base):
    __tablename__ = "livekit_tokens"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    robot_id: Mapped[str] = mapped_column(ForeignKey("robots.id", ondelete="CASCADE"))
    room: Mapped[str] = mapped_column(String(160), nullable=False)
    subject: Mapped[str] = mapped_column(String(20), nullable=False)  # robot|operator
    identity: Mapped[str] = mapped_column(String(160), nullable=False)
    token: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    robot: Mapped[Robot] = relationship(back_populates="tokens")


# --------------------------------------------------------------------------- #
#  Sandbox IA : modèles & catégories
# --------------------------------------------------------------------------- #
class ModelCategory(Base):
    __tablename__ = "model_categories"
    __table_args__ = (UniqueConstraint("model_id", "category_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    model_id: Mapped[str] = mapped_column(ForeignKey("ai_models.id", ondelete="CASCADE"))
    category_id: Mapped[str] = mapped_column(ForeignKey("detection_categories.id", ondelete="CASCADE"))


class AiModel(Base, TimestampMixin):
    __tablename__ = "ai_models"
    __table_args__ = (UniqueConstraint("org_id", "nom", "version", name="uq_ai_model_org_name_version"),)
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    org_id: Mapped[str | None] = mapped_column(ForeignKey("organisations.id", ondelete="SET NULL"))
    nom: Mapped[str] = mapped_column(String(160), nullable=False)
    version: Mapped[str] = mapped_column(String(40), nullable=False)
    tache: Mapped[str] = mapped_column(String(40), default="detection")  # detection|classification
    framework: Mapped[str | None] = mapped_column(String(40))
    runtime: Mapped[str] = mapped_column(String(40), default="onnxruntime")
    description: Mapped[str | None] = mapped_column(Text)
    fichier: Mapped[str | None] = mapped_column(String(512))  # chemin interne, jamais exposé au client
    artifact_name: Mapped[str | None] = mapped_column(String(255))
    artifact_sha256: Mapped[str | None] = mapped_column(String(64))
    artifact_size: Mapped[int | None] = mapped_column(Integer)
    artifact_trusted: Mapped[bool] = mapped_column(Boolean, default=False)
    statut: Mapped[str] = mapped_column(String(20), default="sandbox")  # sandbox|production|archive
    validation_status: Mapped[str] = mapped_column(String(24), default="manifest_valid")
    validation_errors: Mapped[list] = mapped_column(JSON, default=list)
    input_spec: Mapped[dict] = mapped_column(JSON, default=dict)
    output_spec: Mapped[dict] = mapped_column(JSON, default=dict)
    labels: Mapped[list] = mapped_column(JSON, default=list)
    metrics: Mapped[dict] = mapped_column(JSON, default=dict)  # {precision, recall}

    category_links: Mapped[list["ModelCategory"]] = relationship(
        cascade="all, delete-orphan"
    )

    @property
    def category_ids(self) -> list[str]:
        return [link.category_id for link in self.category_links]


class AiModelDeployment(Base, TimestampMixin):
    __tablename__ = "ai_model_deployments"
    __table_args__ = (
        UniqueConstraint("model_id", "robot_id", name="uq_ai_model_deployment_robot"),
    )
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organisations.id", ondelete="CASCADE"))
    model_id: Mapped[str] = mapped_column(ForeignKey("ai_models.id", ondelete="CASCADE"))
    robot_id: Mapped[str] = mapped_column(ForeignKey("robots.id", ondelete="CASCADE"))
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    inference_fps: Mapped[int] = mapped_column(Integer, default=5)
    confidence: Mapped[int] = mapped_column(Integer, default=25)  # pourcentage 0..100
    iou_threshold: Mapped[int] = mapped_column(Integer, default=45)
    overlay_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    incident_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    config: Mapped[dict] = mapped_column(JSON, default=dict)


class AiModelBox(Base, TimestampMixin):
    """Versioned, immutable-on-publication deployment unit for AI models."""

    __tablename__ = "ai_model_boxes"
    __table_args__ = (
        UniqueConstraint("org_id", "nom", "version", name="uq_ai_model_box_org_name_version"),
    )
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organisations.id", ondelete="CASCADE"))
    nom: Mapped[str] = mapped_column(String(160), nullable=False)
    version: Mapped[str] = mapped_column(String(40), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    statut: Mapped[str] = mapped_column(String(20), default="draft")  # draft|published|archive

    items: Mapped[list["AiModelBoxItem"]] = relationship(
        back_populates="box", cascade="all, delete-orphan", order_by="AiModelBoxItem.position"
    )
    assignments: Mapped[list["AiModelBoxAssignment"]] = relationship(
        back_populates="box", cascade="all, delete-orphan"
    )


class AiModelBoxItem(Base):
    __tablename__ = "ai_model_box_items"
    __table_args__ = (
        UniqueConstraint("box_id", "model_id", name="uq_ai_model_box_item_model"),
    )
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    box_id: Mapped[str] = mapped_column(ForeignKey("ai_model_boxes.id", ondelete="CASCADE"))
    model_id: Mapped[str] = mapped_column(ForeignKey("ai_models.id", ondelete="RESTRICT"))
    position: Mapped[int] = mapped_column(Integer, default=0)
    inference_fps: Mapped[int] = mapped_column(Integer, default=5)
    confidence: Mapped[int] = mapped_column(Integer, default=25)
    iou_threshold: Mapped[int] = mapped_column(Integer, default=45)
    overlay_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    incident_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    camera: Mapped[str] = mapped_column(String(80), default="primary")
    config: Mapped[dict] = mapped_column(JSON, default=dict)

    box: Mapped[AiModelBox] = relationship(back_populates="items")
    model: Mapped[AiModel] = relationship()


class AiModelBoxAssignment(Base, TimestampMixin):
    __tablename__ = "ai_model_box_assignments"
    __table_args__ = (
        CheckConstraint(
            "(CASE WHEN robot_id IS NOT NULL THEN 1 ELSE 0 END + "
            "CASE WHEN fleet_id IS NOT NULL THEN 1 ELSE 0 END + "
            "CASE WHEN site_id IS NOT NULL THEN 1 ELSE 0 END) = 1",
            name="ck_ai_model_box_assignment_one_target",
        ),
        UniqueConstraint("box_id", "robot_id", name="uq_ai_model_box_assignment_robot"),
        UniqueConstraint("box_id", "fleet_id", name="uq_ai_model_box_assignment_fleet"),
        UniqueConstraint("box_id", "site_id", name="uq_ai_model_box_assignment_site"),
    )
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organisations.id", ondelete="CASCADE"))
    box_id: Mapped[str] = mapped_column(ForeignKey("ai_model_boxes.id", ondelete="CASCADE"))
    robot_id: Mapped[str | None] = mapped_column(ForeignKey("robots.id", ondelete="CASCADE"))
    fleet_id: Mapped[str | None] = mapped_column(ForeignKey("fleets.id", ondelete="CASCADE"))
    site_id: Mapped[str | None] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)

    box: Mapped[AiModelBox] = relationship(back_populates="assignments")


class DetectionCategory(Base, TimestampMixin):
    __tablename__ = "detection_categories"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    org_id: Mapped[str | None] = mapped_column(ForeignKey("organisations.id", ondelete="SET NULL"))
    code: Mapped[str] = mapped_column(String(60), nullable=False)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    couleur: Mapped[str] = mapped_column(String(16), default="#d85810")
    type: Mapped[str] = mapped_column(String(20), default="retail")  # retail|securite
    actif: Mapped[bool] = mapped_column(Boolean, default=True)


# --------------------------------------------------------------------------- #
#  Audit
# --------------------------------------------------------------------------- #
class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    actor_id: Mapped[str | None] = mapped_column(String(32))
    actor_label: Mapped[str | None] = mapped_column(String(200))
    # Organisation active au moment de l'action. Pas de cle etrangere : la trace
    # doit survivre a la suppression de l'organisation qu'elle documente.
    org_id: Mapped[str | None] = mapped_column(String(32), index=True)
    action: Mapped[str] = mapped_column(String(60), nullable=False)  # USER_CREATE, TOKEN_ISSUE...
    resource: Mapped[str | None] = mapped_column(String(200))
    result: Mapped[str] = mapped_column(String(20), default="success")
    ip: Mapped[str | None] = mapped_column(String(60))


# --------------------------------------------------------------------------- #
#  Jetons à usage unique : invitation et réinitialisation de mot de passe
# --------------------------------------------------------------------------- #
class AuthToken(Base):
    """Jeton d'activation ou de réinitialisation, à usage unique.

    Seule l'empreinte SHA-256 du jeton est conservée. Une fuite de la base ne
    permet donc pas de prendre la main sur un compte : le secret n'existe que
    dans le courriel envoyé et dans l'URL que l'utilisateur ouvre.

    `used_at` marque la consommation. Un jeton consommé n'est pas supprimé :
    il sert de trace, et son existence permet de distinguer « lien déjà
    utilisé » de « lien inconnu » dans les journaux, sans le dire au visiteur.
    """

    __tablename__ = "auth_tokens"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(20), nullable=False)  # invite|reset
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    requested_ip: Mapped[str | None] = mapped_column(String(60))

    __table_args__ = (
        CheckConstraint("kind in ('invite','reset')", name="ck_auth_tokens_kind"),
    )


# --------------------------------------------------------------------------- #
#  Studio de déploiement : bundles, versions, déploiements
# --------------------------------------------------------------------------- #
class DeploymentBundle(Base, TimestampMixin):
    """Unité déployable composée dans le Studio.

    Le bundle porte l'identité stable (nom, code, cible d'exécution) ; ce qui
    change au fil du travail vit dans ses versions. Séparer les deux est ce qui
    permet de dire « le robot tourne en version 3 » sans figer le nom, et de
    revenir à une version antérieure sans recréer un objet.
    """

    __tablename__ = "deployment_bundles"
    __table_args__ = (UniqueConstraint("org_id", "slug", name="uq_deployment_bundle_org_slug"),)
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organisations.id", ondelete="CASCADE"))
    nom: Mapped[str] = mapped_column(String(160), nullable=False)
    slug: Mapped[str] = mapped_column(String(80), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    target: Mapped[str] = mapped_column(String(60), default="ENVIRONNEMENT_EXECUTION_ROBOT")
    statut: Mapped[str] = mapped_column(String(20), default="active")  # active|archived
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    versions: Mapped[list["BundleVersion"]] = relationship(
        back_populates="bundle", cascade="all, delete-orphan", order_by="BundleVersion.numero"
    )


class CompositionPreset(Base, TimestampMixin):
    """Composition de référence livrée par la plateforme.

    Un préset n'appartient à aucune organisation, et c'est ce qui le sépare
    d'un bundle : un bundle est le travail d'un client sur ses robots, un
    préset est un point de départ que nous maintenons et que tous voient. La
    bibliothèque s'enrichit d'un châssis à la fois.

    `famille` nomme le profil de châssis visé — `rosmaster-m3pro`,
    `unitree-g1`. C'est le même identifiant que celui qui donne son nom à
    l'image du runtime : un préset et l'image qui le fera tourner désignent
    ainsi le même matériel, sans table de correspondance à tenir à jour.
    """

    __tablename__ = "composition_presets"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    slug: Mapped[str] = mapped_column(String(80), nullable=False, unique=True)
    nom: Mapped[str] = mapped_column(String(160), nullable=False)
    constructeur: Mapped[str | None] = mapped_column(String(80))
    famille: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    spec: Mapped[dict] = mapped_column(JSON, default=dict)
    statut: Mapped[str] = mapped_column(String(20), default="draft")  # draft|published|archived
    # Ordre d'affichage dans le sélecteur ; à défaut, le nom départage.
    ordre: Mapped[int] = mapped_column(Integer, default=100)
    # Version du préset lui-même : un préset corrigé reste le même préset.
    revision: Mapped[int] = mapped_column(Integer, default=1)
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class BundleVersion(Base, TimestampMixin):
    """Une version de bundle : brouillon tant qu'elle se modifie, figée ensuite.

    `checksum` est calculé sur la composition canonique. C'est lui que le robot
    renvoie dans son compte rendu : il prouve que ce qui tourne est bien ce qui
    a été publié, là où un simple numéro de version se contenterait de
    l'affirmer.
    """

    __tablename__ = "bundle_versions"
    __table_args__ = (UniqueConstraint("bundle_id", "numero", name="uq_bundle_version_numero"),)
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    bundle_id: Mapped[str] = mapped_column(ForeignKey("deployment_bundles.id", ondelete="CASCADE"))
    numero: Mapped[int] = mapped_column(Integer, nullable=False)
    statut: Mapped[str] = mapped_column(String(20), default="draft")  # draft|published|archived
    spec: Mapped[dict] = mapped_column(JSON, default=dict)
    checksum: Mapped[str | None] = mapped_column(String(64))
    notes: Mapped[str | None] = mapped_column(Text)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    published_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    bundle: Mapped[DeploymentBundle] = relationship(back_populates="versions")

    @property
    def editing_revision(self) -> str:
        # Distinct du checksum runtime : déplacer un bloc est aussi une édition.
        from .bundle_spec import empreinte
        return empreinte({"id": self.id, "statut": self.statut, "spec": self.spec, "notes": self.notes})


class BundleDeployment(Base, TimestampMixin):
    """Fait daté : telle version a été demandée sur tel robot.

    Une nouvelle demande ne réécrit pas la précédente, elle la remplace en la
    passant à `superseded`. L'historique reste lisible après coup, y compris
    quand un déploiement a échoué : c'est la seule façon de répondre à « depuis
    quand ce robot est-il dans cet état ? ».
    """

    __tablename__ = "bundle_deployments"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organisations.id", ondelete="CASCADE"))
    version_id: Mapped[str] = mapped_column(ForeignKey("bundle_versions.id", ondelete="RESTRICT"))
    robot_id: Mapped[str] = mapped_column(ForeignKey("robots.id", ondelete="CASCADE"), index=True)
    # pending : demandé, pas encore retiré par le robot
    # delivered : le robot a récupéré la composition
    # prepared : configuration déposée, sans confirmation du runtime
    # active : le robot a confirmé l'avoir appliquée
    # failed : le robot a signalé un échec
    # superseded : remplacé par un déploiement plus récent
    statut: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    requested_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    message: Mapped[str | None] = mapped_column(Text)
    report: Mapped[dict] = mapped_column(JSON, default=dict)

    version: Mapped[BundleVersion] = relationship()
    robot: Mapped[Robot] = relationship()


class EdgeRelease(Base, TimestampMixin):
    """Paquet embarqué distribuable, versionné et vérifiable.

    Distribuer du code exécutable n'est pas distribuer de la configuration : on
    garde l'empreinte de l'archive pour que le robot refuse ce qui ne
    correspond pas, et on passe par des canaux (`stable`, `beta`) pour qu'une
    version parte d'abord sur un robot témoin plutôt que sur toute la flotte.
    """

    __tablename__ = "edge_releases"
    __table_args__ = (UniqueConstraint("version", name="uq_edge_release_version"),)
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    version: Mapped[str] = mapped_column(String(40), nullable=False)
    canal: Mapped[str] = mapped_column(String(20), default="stable")  # stable|beta
    statut: Mapped[str] = mapped_column(String(20), default="draft")  # draft|published|archived
    fichier: Mapped[str] = mapped_column(String(512), nullable=False)  # chemin interne
    archive_nom: Mapped[str] = mapped_column(String(255), nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    taille: Mapped[int] = mapped_column(Integer, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    published_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
