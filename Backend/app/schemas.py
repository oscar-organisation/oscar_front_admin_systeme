from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

ORM = ConfigDict(from_attributes=True)


# ---- Auth ------------------------------------------------------------------
class LoginIn(BaseModel):
    email: EmailStr
    password: str


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class OrganisationContextOut(BaseModel):
    id: str
    nom: str
    slug: str
    parent_id: str | None = None
    is_primary: bool = False
    roles: list[str] = Field(default_factory=list)
    permissions: dict[str, list[str]] = Field(default_factory=dict)


class MeOut(BaseModel):
    id: str
    email: str
    nom: str
    org_id: str | None
    active_org_id: str | None = None
    organisations: list[OrganisationContextOut] = Field(default_factory=list)
    is_superadmin: bool
    features: list[str]            # codes accordés (api:* + ui:*)
    permissions: dict[str, list[str]]  # code -> actions
    # Ajoutés pour la page de compte personnel : sans eux, elle affichait
    # « Aucun rôle attribué » et un statut vide quel que soit l'utilisateur.
    statut: str
    roles: list[str] = Field(default_factory=list)
    active_org_nom: str | None = None


# ---- Organisations ---------------------------------------------------------
class OrgIn(BaseModel):
    nom: str
    slug: str
    contact: str | None = None
    statut: str = "active"
    category_id: str | None = None
    parent_id: str | None = None


class OrgOut(OrgIn):
    model_config = ORM
    id: str
    created_at: datetime | None = None
    category_nom: str | None = None
    parent_nom: str | None = None
    depth: int = 0


class OrganisationCategoryIn(BaseModel):
    code: str
    nom: str
    description: str | None = None


class OrganisationCategoryOut(OrganisationCategoryIn):
    model_config = ORM
    id: str


class OrganisationMembershipIn(BaseModel):
    org_ids: list[str] = Field(default_factory=list)
    primary_org_id: str | None = None


class OnboardingSiteIn(BaseModel):
    nom: str
    code: str
    adresse: str | None = None


class OnboardingAdministratorIn(BaseModel):
    nom: str
    email: EmailStr
    password: str = Field(min_length=8)
    role_ids: list[str] = Field(default_factory=list)


class OrganisationOnboardingIn(BaseModel):
    organisation: OrgIn
    site: OnboardingSiteIn | None = None
    administrator: OnboardingAdministratorIn


class OrganisationOnboardingOut(BaseModel):
    organisation_id: str
    site_id: str | None = None
    administrator_id: str


# ---- Sites -----------------------------------------------------------------
class SiteIn(BaseModel):
    org_id: str
    nom: str
    code: str
    adresse: str | None = None
    zones: list[str] = Field(default_factory=list)
    statut: str = "operational"


class SiteOut(SiteIn):
    model_config = ORM
    id: str


# ---- Utilisateurs ----------------------------------------------------------
class UserIn(BaseModel):
    email: EmailStr
    nom: str
    org_id: str | None = None
    password: str | None = Field(default=None, min_length=8)
    statut: str = "invited"


class UserUpdate(BaseModel):
    email: EmailStr | None = None
    nom: str | None = None
    org_id: str | None = None
    statut: str | None = None
    password: str | None = Field(default=None, min_length=8)


class RoleAssignIn(BaseModel):
    role_id: str
    scope_type: str = "all"       # all|org|site
    scope_id: str | None = None


class RoleSetIn(BaseModel):
    role_ids: list[str] = Field(default_factory=list)


class IdSetIn(BaseModel):
    ids: list[str] = Field(default_factory=list)


class UserRoleOut(BaseModel):
    role_id: str
    role_nom: str
    scope_type: str
    scope_id: str | None = None


class UserOut(BaseModel):
    model_config = ORM
    id: str
    email: str
    nom: str
    org_id: str | None
    statut: str
    is_superadmin: bool
    last_login_at: datetime | None = None
    org_nom: str | None = None
    organisation_ids: list[str] = Field(default_factory=list)
    role_group_ids: list[str] = Field(default_factory=list)
    roles: list[UserRoleOut] = Field(default_factory=list)


# ---- Rôles & features ------------------------------------------------------
class FeatureOut(BaseModel):
    model_config = ORM
    code: str
    label: str
    type: str
    module: str
    actions: list[str]


class PermissionIn(BaseModel):
    feature_code: str
    actions: list[str]


class RoleIn(BaseModel):
    nom: str
    description: str | None = None
    org_id: str | None = None
    visibility: str = "private"


class RoleOut(BaseModel):
    model_config = ORM
    id: str
    nom: str
    description: str | None
    org_id: str | None
    is_system: bool
    visibility: str = "private"


class RoleDetailOut(RoleOut):
    permissions: list[PermissionIn]
    permission_group_ids: list[str] = Field(default_factory=list)


# ---- Equipes et regroupements IAM -----------------------------------------
class TeamIn(BaseModel):
    nom: str
    description: str | None = None
    statut: str = "active"
    org_ids: list[str] = Field(default_factory=list)


class TeamMemberOut(BaseModel):
    user_id: str
    nom: str
    email: str
    title: str | None = None


class TeamOut(BaseModel):
    id: str
    nom: str
    description: str | None = None
    statut: str
    org_ids: list[str] = Field(default_factory=list)
    members: list[TeamMemberOut] = Field(default_factory=list)
    role_ids: list[str] = Field(default_factory=list)
    role_group_ids: list[str] = Field(default_factory=list)


class TeamMembersIn(BaseModel):
    user_ids: list[str] = Field(default_factory=list)


class TeamAccessIn(BaseModel):
    role_ids: list[str] = Field(default_factory=list)
    role_group_ids: list[str] = Field(default_factory=list)
    scope_type: str = "all"
    scope_id: str | None = None


class PermissionGroupIn(BaseModel):
    nom: str
    description: str | None = None
    org_id: str | None = None
    visibility: str = "private"
    permissions: list[PermissionIn] = Field(default_factory=list)


class PermissionGroupOut(PermissionGroupIn):
    id: str


class RoleGroupIn(BaseModel):
    nom: str
    description: str | None = None
    org_id: str | None = None
    visibility: str = "private"
    role_ids: list[str] = Field(default_factory=list)
    permission_group_ids: list[str] = Field(default_factory=list)


class RoleGroupOut(RoleGroupIn):
    id: str


class FleetIn(BaseModel):
    org_id: str
    nom: str
    code: str
    description: str | None = None
    robot_ids: list[str] = Field(default_factory=list)


class FleetOut(FleetIn):
    id: str


# ---- Robots ----------------------------------------------------------------
class RobotIn(BaseModel):
    nom: str
    org_id: str | None = None
    site_id: str | None = None
    serial: str | None = None
    firmware: str | None = None
    # Modele du chassis, tel que l'operateur le decrit. Texte libre, conserve
    # sans transformation : personne ne connait tous les chassis existants, et
    # deviner leur identifiant technique produirait des erreurs silencieuses.
    modele: str | None = None
    statut: str = "offline"
    batterie: int | None = None
    capacites: list[str] = Field(default_factory=list)


class RobotAssignIn(BaseModel):
    user_id: str
    op_role: str = "pilote"       # pilote|superviseur


class RobotOut(RobotIn):
    model_config = ORM
    id: str
    # Identifiant terrain, derive du nom : c'est celui que porte l'agent embarque.
    slug: str | None = None
    edge_channel: str = "stable"
    edge_version: str | None = None
    # Famille technique declaree par le robot, lue dans son profil embarque.
    # C'est elle qui vaut cle : le catalogue de presets s'y accroche, pas a
    # l'etiquette humaine.
    modele_constate: str | None = None


class TokenIssueIn(BaseModel):
    operator_id: str | None = None      # opérateur qui recevra le token_operator
    session_suffix: str | None = None   # pour la room


class LiveKitTokenOut(BaseModel):
    model_config = ORM
    id: str
    room: str
    subject: str
    identity: str
    token: str
    expires_at: datetime
    revoked: bool


class TokenPairOut(BaseModel):
    room: str
    livekit_url: str
    robot: LiveKitTokenOut
    operator: LiveKitTokenOut | None = None


# ---- Sandbox IA ------------------------------------------------------------
class CategoryIn(BaseModel):
    code: str
    label: str
    couleur: str = "#d85810"
    type: str = "retail"
    actif: bool = True
    org_id: str | None = None


class CategoryOut(CategoryIn):
    model_config = ORM
    id: str


class ModelOut(BaseModel):
    model_config = ORM
    id: str
    org_id: str | None = None
    nom: str
    version: str
    tache: str
    framework: str | None
    runtime: str
    description: str | None = None
    artifact_name: str | None = None
    artifact_sha256: str | None = None
    artifact_size: int | None = None
    artifact_trusted: bool = False
    statut: str
    validation_status: str
    validation_errors: list = Field(default_factory=list)
    input_spec: dict = Field(default_factory=dict)
    output_spec: dict = Field(default_factory=dict)
    labels: list[str] = Field(default_factory=list)
    category_ids: list[str] = Field(default_factory=list)
    metrics: dict
    created_at: datetime | None = None
    # Verdict d'executabilite, calcule par l'API : l'interface l'affiche au lieu
    # de recopier la liste des runtimes et des taches supportes.
    deployable: bool = False
    blocage: str | None = None


class ModelPromoteIn(BaseModel):
    statut: str  # production|archive|sandbox


class ModelDeploymentIn(BaseModel):
    enabled: bool = False
    inference_fps: int = Field(default=5, ge=1, le=30)
    confidence: int = Field(default=25, ge=0, le=100)
    iou_threshold: int = Field(default=45, ge=0, le=100)
    overlay_enabled: bool = True
    incident_enabled: bool = False
    config: dict = Field(default_factory=dict)


class ModelDeploymentOut(ModelDeploymentIn):
    model_config = ORM
    id: str
    org_id: str
    model_id: str
    robot_id: str
    created_at: datetime | None = None
    updated_at: datetime | None = None


class ModelBoxItemIn(BaseModel):
    model_id: str
    position: int = Field(default=0, ge=0, le=1000)
    inference_fps: int = Field(default=5, ge=1, le=30)
    confidence: int = Field(default=25, ge=0, le=100)
    iou_threshold: int = Field(default=45, ge=0, le=100)
    overlay_enabled: bool = True
    incident_enabled: bool = False
    camera: str = Field(default="primary", min_length=1, max_length=80)
    config: dict = Field(default_factory=dict)


class ModelBoxIn(BaseModel):
    nom: str = Field(min_length=2, max_length=160)
    version: str = Field(min_length=1, max_length=40)
    description: str | None = None
    items: list[ModelBoxItemIn] = Field(default_factory=list, max_length=50)


class ModelBoxItemOut(ModelBoxItemIn):
    id: str
    model_name: str
    model_version: str
    model_runtime: str
    model_status: str


class ModelBoxOut(BaseModel):
    id: str
    org_id: str
    nom: str
    version: str
    description: str | None = None
    statut: str
    items: list[ModelBoxItemOut] = Field(default_factory=list)
    assignment_count: int = 0
    created_at: datetime | None = None
    updated_at: datetime | None = None


class ModelBoxCloneIn(BaseModel):
    version: str = Field(min_length=1, max_length=40)


class ModelBoxAssignmentIn(BaseModel):
    enabled: bool = True


class ModelBoxAssignmentOut(BaseModel):
    id: str
    org_id: str
    box_id: str
    box_name: str
    box_version: str
    robot_id: str | None = None
    fleet_id: str | None = None
    site_id: str | None = None
    enabled: bool
    created_at: datetime | None = None
    updated_at: datetime | None = None


# ---- Audit -----------------------------------------------------------------
class AuditOut(BaseModel):
    model_config = ORM
    id: str
    ts: datetime
    actor_label: str | None
    action: str
    resource: str | None
    result: str
    ip: str | None


# --------------------------------------------------------------------------- #
#  Mot de passe : oubli, réinitialisation, invitation, compte personnel
# --------------------------------------------------------------------------- #
class ForgotPasswordIn(BaseModel):
    email: EmailStr


class ResetPasswordIn(BaseModel):
    token: str
    password: str


class InvitationCheckOut(BaseModel):
    """Réponse volontairement minimale : elle ne dit rien que le porteur du
    lien ne sache déjà, et ne révèle jamais pourquoi un lien est refusé."""
    valide: bool
    email: str | None = None
    nom: str | None = None
    kind: str | None = None


class ProfileUpdateIn(BaseModel):
    nom: str | None = None
    email: EmailStr | None = None


class PasswordChangeIn(BaseModel):
    current_password: str
    new_password: str


class PasswordPolicyOut(BaseModel):
    min_length: int


# ---- Studio de déploiement -------------------------------------------------
class BundleIn(BaseModel):
    nom: str = Field(min_length=2, max_length=160)
    description: str | None = None
    target: str = Field(default="ENVIRONNEMENT_EXECUTION_ROBOT", max_length=60)


class BundleDraftIn(BaseModel):
    """Composition en cours d'édition, telle que le Studio l'envoie."""

    spec: dict = Field(default_factory=dict)
    notes: str | None = None
    expected_revision: str | None = None


class BundlePublishIn(BaseModel):
    notes: str | None = None
    expected_revision: str | None = None


class BundleVersionOut(BaseModel):
    model_config = ORM
    id: str
    bundle_id: str
    numero: int
    statut: str
    checksum: str | None = None
    editing_revision: str
    notes: str | None = None
    published_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class BundleVersionDetailOut(BundleVersionOut):
    spec: dict = Field(default_factory=dict)


class BundleOut(BaseModel):
    model_config = ORM
    id: str
    org_id: str
    nom: str
    slug: str
    description: str | None = None
    target: str
    statut: str
    created_at: datetime | None = None
    updated_at: datetime | None = None
    draft_version: BundleVersionOut | None = None
    published_version: BundleVersionOut | None = None
    version_count: int = 0
    robot_count: int = 0
    # De quoi remplir une liste sans télécharger chaque composition.
    component_count: int = 0
    agent_count: int = 0


class BundleValidationOut(BaseModel):
    valide: bool
    erreurs: list[str] = Field(default_factory=list)
    avertissements: list[str] = Field(default_factory=list)


class DeploymentIn(BaseModel):
    version_id: str
    # Trois portees, comme du cote des Box IA : un robot nomme, une flotte, un
    # site. Elles se cumulent, et l'union est dedupliquee — cibler une flotte
    # et l'un de ses robots ne cree pas deux deploiements.
    robot_ids: list[str] = Field(default_factory=list, max_length=200)
    fleet_id: str | None = None
    site_id: str | None = None
    message: str | None = None


class DeploymentOut(BaseModel):
    model_config = ORM
    id: str
    org_id: str
    version_id: str
    robot_id: str
    statut: str
    message: str | None = None
    report: dict = Field(default_factory=dict)
    delivered_at: datetime | None = None
    applied_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    bundle_id: str | None = None
    bundle_nom: str | None = None
    version_numero: int | None = None
    robot_nom: str | None = None
    robot_slug: str | None = None


class DeploymentReportIn(BaseModel):
    deployment_id: str
    statut: str = Field(pattern="^(prepared|active|failed)$")
    checksum: str | None = None
    message: str | None = None
    report: dict = Field(default_factory=dict)


# ---- Paquet embarqué -------------------------------------------------------
class EdgeReleaseOut(BaseModel):
    model_config = ORM
    id: str
    version: str
    canal: str
    statut: str
    sha256: str
    taille: int
    archive_nom: str
    notes: str | None = None
    published_at: datetime | None = None
    created_at: datetime | None = None


class EdgeReleaseReportIn(BaseModel):
    """Compte rendu d'installation renvoyé par le robot."""

    version: str
    statut: str = Field(pattern="^(installed|failed|rolled_back)$")
    message: str | None = None
    sha256: str | None = None
    # Famille de chassis lue dans le profil embarque. Le robot est la seule
    # source qui sache vraiment sur quel materiel il tourne ; la saisie de
    # l'operateur n'est qu'une intention.
    profil: str | None = None


class CompositionPresetIn(BaseModel):
    """Préset versé au catalogue de la plateforme."""

    slug: str = Field(min_length=2, max_length=80)
    nom: str = Field(min_length=2, max_length=160)
    famille: str = Field(min_length=2, max_length=80)
    constructeur: str | None = None
    description: str | None = None
    spec: dict = Field(default_factory=dict)
    ordre: int = 100
    notes: str | None = None


class CompositionPresetPatch(BaseModel):
    """Correction d'un préset. Tout est optionnel : on ne touche qu'au nécessaire."""

    nom: str | None = None
    famille: str | None = None
    constructeur: str | None = None
    description: str | None = None
    spec: dict | None = None
    statut: str | None = None
    ordre: int | None = None
    notes: str | None = None


class CompositionPresetOut(BaseModel):
    model_config = ORM
    id: str
    slug: str
    nom: str
    famille: str
    constructeur: str | None = None
    description: str | None = None
    spec: dict = Field(default_factory=dict)
    statut: str
    ordre: int
    revision: int
    notes: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class PerceptionLeaseIn(BaseModel):
    """Ce qu'un worker de perception annonce à chaque battement."""

    # Nombre de robots que ce worker accepte de porter. C'est lui qui le sait :
    # il connaît sa mémoire, ses cœurs et les modèles déjà chargés.
    capacite: int = 4


class PerceptionLeasesOut(BaseModel):
    worker_id: str
    robots: list[str] = Field(default_factory=list)
    # Le serveur dicte la cadence plutôt que de la laisser à chaque worker :
    # allonger le bail sans allonger le battement ferait expirer la flotte.
    renouveler_dans: int


class PerceptionCouvertureOut(BaseModel):
    robot_id: str
    nom: str
    worker_id: str
    depuis: datetime
    expire_a: datetime


class PerceptionDecouvertOut(BaseModel):
    robot_id: str
    nom: str


class PerceptionCoverageOut(BaseModel):
    couverts: list[PerceptionCouvertureOut] = Field(default_factory=list)
    # La liste qui compte : un robot qui mérite la perception et n'a pas de
    # bail vivant. C'est la question que personne n'a pu poser le 23 septembre.
    decouverts: list[PerceptionDecouvertOut] = Field(default_factory=list)
    workers: list[str] = Field(default_factory=list)
