"""Studio de déploiement : bundles, versions et déploiements robot.

Trois idées structurent ce module.

1. Le bundle porte l'identité, la version porte le contenu. Publier fige une
   version : elle ne se modifie plus, on en crée une suivante.
2. Un déploiement est un fait daté, pas un champ du robot. Une nouvelle demande
   ne réécrit pas la précédente, elle la remplace (`superseded`).
3. Le robot tire, le serveur ne pousse pas. L'agent embarqué appelle
   `/runtime/...` avec sa clé, récupère le manifeste à appliquer et rend compte.
   Aucun port n'a besoin d'être ouvert sur le robot, ce qui vaut aussi derrière
   le partage de connexion d'un téléphone.
"""

import hashlib
import hmac
import re
from pathlib import Path
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import FileResponse
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session, selectinload

from ..bundle_spec import (
    RUNTIME_FORMAT,
    boites_ia,
    empreinte,
    manifeste_runtime,
    valider_specification,
)
from ..config import settings
from ..database import get_db
from ..deps import request_organisation_id, require, sans_perimetre, write_audit
from ..models import (
    AiModelBox,
    EdgeRelease,
    AiModelBoxAssignment,
    BundleDeployment,
    BundleVersion,
    DeploymentBundle,
    Fleet,
    FleetRobot,
    Robot,
)
from ..schemas import (
    BundleDraftIn,
    EdgeReleaseReportIn,
    BundleIn,
    BundleOut,
    BundlePublishIn,
    BundleValidationOut,
    BundleVersionDetailOut,
    BundleVersionOut,
    DeploymentIn,
    DeploymentOut,
    DeploymentReportIn,
)

router = APIRouter(prefix="/studio", tags=["studio"])

# Statuts qu'un déploiement plus récent remplace.
EN_COURS = ("pending", "delivered", "prepared", "active")


def _maintenant() -> datetime:
    return datetime.now(timezone.utc)


def _slug(valeur: str, defaut: str = "bundle") -> str:
    base = re.sub(r"[^a-z0-9]+", "-", (valeur or "").lower()).strip("-")
    return base[:80] or defaut


def _organisation_active(request: Request) -> str:
    """Organisation sur laquelle écrire.

    Un bundle appartient toujours à une organisation : en vue globale, le
    superadmin doit en choisir une avant d'en composer un, sans quoi l'objet
    créé n'aurait pas de propriétaire.
    """
    org_id = request_organisation_id(request)
    if not org_id:
        raise HTTPException(409, "Sélectionnez une organisation avant de composer un bundle")
    return org_id


def _bundle_du_perimetre(db: Session, bundle_id: str, org_id: str | None) -> DeploymentBundle:
    bundle = db.execute(
        select(DeploymentBundle)
        .where(DeploymentBundle.id == bundle_id)
        .with_for_update()
        .options(selectinload(DeploymentBundle.versions))
    ).scalar_one_or_none()
    if not bundle or (org_id and bundle.org_id != org_id):
        raise HTTPException(404, "Bundle introuvable")
    return bundle


def _version_du_perimetre(db: Session, version_id: str, org_id: str | None) -> BundleVersion:
    version = db.get(BundleVersion, version_id)
    if not version:
        raise HTTPException(404, "Version introuvable")
    bundle = db.get(DeploymentBundle, version.bundle_id)
    if not bundle or (org_id and bundle.org_id != org_id):
        raise HTTPException(404, "Version introuvable")
    return version


def _robot_du_perimetre(db: Session, robot_id: str, org_id: str | None) -> Robot:
    robot = db.get(Robot, robot_id)
    if not robot or (org_id and robot.org_id != org_id):
        raise HTTPException(404, "Robot introuvable")
    if not robot.org_id:
        raise HTTPException(409, "Le robot doit être rattaché à une organisation")
    return robot


def _verifier_boites(db: Session, spec: dict, org_id: str) -> list[AiModelBox]:
    """Une Box citee par une composition doit etre deployable, et a nous.

    Publier une version qui nomme une Box en brouillon reviendrait a promettre
    au robot une perception qui n'existe pas encore.
    """
    identifiants = boites_ia(spec)
    if not identifiants:
        return []
    boites = db.execute(select(AiModelBox).where(AiModelBox.id.in_(identifiants))).scalars().all()
    par_id = {boite.id: boite for boite in boites}
    manquantes = [identifiant for identifiant in identifiants if identifiant not in par_id]
    if manquantes:
        raise HTTPException(409, "Box IA introuvable : " + ", ".join(manquantes))
    etrangeres = [boite.nom for boite in boites if boite.org_id != org_id]
    if etrangeres:
        raise HTTPException(409, "Box IA d'une autre organisation : " + ", ".join(etrangeres))
    brouillons = [f"{boite.nom} v{boite.version}" for boite in boites if boite.statut != "published"]
    if brouillons:
        raise HTTPException(409, "Box IA non publiée : " + " ; ".join(brouillons))
    return [par_id[identifiant] for identifiant in identifiants]


def _appliquer_boites(db: Session, version: BundleVersion, robot: Robot, org_id: str) -> list[str]:
    """Aligne les Box IA du robot sur ce que declare la version deployee.

    Le bundle devient la seule source de verite pour ce robot : ce qu'il
    declare est active, ce qu'il ne declare pas est desactive. Sans cela, une
    Box oubliee continuerait de tourner a cote d'une composition qui ne la
    mentionne plus.
    """
    voulues = set(boites_ia(version.spec))
    existantes = db.execute(
        select(AiModelBoxAssignment).where(AiModelBoxAssignment.robot_id == robot.id)
    ).scalars().all()
    appliquees = []
    for assignation in existantes:
        actif = assignation.box_id in voulues
        if assignation.enabled != actif:
            assignation.enabled = actif
        if actif:
            appliquees.append(assignation.box_id)
    for box_id in voulues:
        if box_id not in {assignation.box_id for assignation in existantes}:
            db.add(AiModelBoxAssignment(org_id=org_id, box_id=box_id, robot_id=robot.id, enabled=True))
            appliquees.append(box_id)
    return appliquees


def _brouillon(bundle: DeploymentBundle) -> BundleVersion | None:
    return next((v for v in bundle.versions if v.statut == "draft"), None)


def _derniere_publiee(bundle: DeploymentBundle) -> BundleVersion | None:
    publiees = [v for v in bundle.versions if v.statut == "published"]
    return max(publiees, key=lambda v: v.numero) if publiees else None


def _bundle_out(db: Session, bundle: DeploymentBundle) -> dict:
    publiee = _derniere_publiee(bundle)
    robots = 0
    if publiee:
        robots = db.execute(
            select(func.count(func.distinct(BundleDeployment.robot_id)))
            .where(BundleDeployment.version_id.in_([v.id for v in bundle.versions]))
            .where(BundleDeployment.statut.in_(EN_COURS))
        ).scalar_one()
    courante = _brouillon(bundle) or publiee
    manifeste = manifeste_runtime(courante.spec) if courante else {"composants": []}
    composants = manifeste.get("composants", [])
    return {
        "id": bundle.id, "org_id": bundle.org_id, "nom": bundle.nom, "slug": bundle.slug,
        "description": bundle.description, "target": bundle.target, "statut": bundle.statut,
        "created_at": bundle.created_at, "updated_at": bundle.updated_at,
        "draft_version": _brouillon(bundle),
        "published_version": publiee,
        "version_count": len(bundle.versions),
        "robot_count": robots,
        "component_count": len(composants),
        "agent_count": sum(len(composant.get("agents", [])) for composant in composants),
    }


def _deployment_out(deployment: BundleDeployment, version: BundleVersion | None,
                    bundle: DeploymentBundle | None, robot: Robot | None) -> dict:
    return {
        "id": deployment.id, "org_id": deployment.org_id, "version_id": deployment.version_id,
        "robot_id": deployment.robot_id, "statut": deployment.statut,
        "message": deployment.message, "report": deployment.report,
        "delivered_at": deployment.delivered_at, "applied_at": deployment.applied_at,
        "created_at": deployment.created_at, "updated_at": deployment.updated_at,
        "bundle_id": bundle.id if bundle else None,
        "bundle_nom": bundle.nom if bundle else None,
        "version_numero": version.numero if version else None,
        "robot_nom": robot.nom if robot else None,
        "robot_slug": robot.slug if robot else None,
    }


# --------------------------------------------------------------------------- #
#  Bundles
# --------------------------------------------------------------------------- #
@router.get("/bundles", response_model=list[BundleOut])
def list_bundles(request: Request, db: Session = Depends(get_db),
                 _=Depends(require("api:bundle.read"))):
    if sans_perimetre(request):
        return []
    query = select(DeploymentBundle).options(selectinload(DeploymentBundle.versions))
    org_id = request_organisation_id(request)
    if org_id:
        query = query.where(DeploymentBundle.org_id == org_id)
    bundles = db.execute(query.order_by(DeploymentBundle.nom)).scalars().all()
    return [_bundle_out(db, bundle) for bundle in bundles]


@router.post("/bundles", response_model=BundleOut, status_code=201)
def create_bundle(request: Request, body: BundleIn, db: Session = Depends(get_db),
                  user=Depends(require("api:bundle.write", "create"))):
    org_id = _organisation_active(request)
    slug = _slug(body.nom)
    existant = db.execute(
        select(DeploymentBundle)
        .where(DeploymentBundle.org_id == org_id, DeploymentBundle.slug == slug)
    ).scalar_one_or_none()
    if existant:
        raise HTTPException(409, "Un bundle porte déjà ce nom dans cette organisation")
    bundle = DeploymentBundle(
        org_id=org_id, nom=body.nom.strip(), slug=slug, description=body.description,
        target=body.target, created_by=user.id,
    )
    db.add(bundle)
    db.commit()
    db.refresh(bundle)
    write_audit(db, actor=user, action="BUNDLE_CREATE", resource=bundle.nom, org_id=org_id)
    return _bundle_out(db, bundle)


@router.get("/bundles/{bundle_id}", response_model=BundleOut)
def get_bundle(request: Request, bundle_id: str, db: Session = Depends(get_db),
               _=Depends(require("api:bundle.read"))):
    bundle = _bundle_du_perimetre(db, bundle_id, request_organisation_id(request))
    return _bundle_out(db, bundle)


@router.patch("/bundles/{bundle_id}", response_model=BundleOut)
def update_bundle(request: Request, bundle_id: str, body: BundleIn, db: Session = Depends(get_db),
                  user=Depends(require("api:bundle.write", "update"))):
    bundle = _bundle_du_perimetre(db, bundle_id, request_organisation_id(request))
    bundle.nom = body.nom.strip()
    bundle.description = body.description
    bundle.target = body.target
    db.commit()
    db.refresh(bundle)
    write_audit(db, actor=user, action="BUNDLE_UPDATE", resource=bundle.nom, org_id=bundle.org_id)
    return _bundle_out(db, bundle)


@router.delete("/bundles/{bundle_id}", status_code=204)
def delete_bundle(request: Request, bundle_id: str, db: Session = Depends(get_db),
                  user=Depends(require("api:bundle.write", "delete"))):
    bundle = _bundle_du_perimetre(db, bundle_id, request_organisation_id(request))
    deploye = db.execute(
        select(func.count())
        .select_from(BundleDeployment)
        .where(BundleDeployment.version_id.in_([v.id for v in bundle.versions]))
    ).scalar_one()
    if deploye:
        # Supprimer effacerait l'historique de ce qui a tourné sur les robots.
        raise HTTPException(409, "Ce bundle a déjà été déployé : archivez-le au lieu de le supprimer")
    nom = bundle.nom
    org_id = bundle.org_id
    db.delete(bundle)
    db.commit()
    write_audit(db, actor=user, action="BUNDLE_DELETE", resource=nom, org_id=org_id)


@router.put("/bundles/{bundle_id}/draft", response_model=BundleVersionDetailOut)
def save_draft(request: Request, bundle_id: str, body: BundleDraftIn, db: Session = Depends(get_db),
               user=Depends(require("api:bundle.write", "update"))):
    """Enregistre la composition en cours, sans rien figer.

    Le Studio garde son brouillon dans le navigateur (mode hors ligne) ; cet
    appel en fait une copie serveur, celle que retrouvera un collègue ou un
    autre poste.
    """
    bundle = _bundle_du_perimetre(db, bundle_id, request_organisation_id(request))
    version = _brouillon(bundle)
    actuelle = version or _derniere_publiee(bundle)
    if "expected_revision" in body.model_fields_set and body.expected_revision != (
        actuelle.editing_revision if actuelle else None
    ):
        raise HTTPException(409, "Brouillon modifié sur un autre poste : rechargez ou conservez une copie locale")
    try:
        checksum = empreinte(manifeste_runtime(body.spec))
        valider_specification(body.spec)
    except (TypeError, ValueError, AttributeError):
        raise HTTPException(422, "Structure de composition invalide (nodes, agents, canaux ou edges)")
    if version is None:
        dernier = max((v.numero for v in bundle.versions), default=0)
        version = BundleVersion(bundle_id=bundle.id, numero=dernier + 1, statut="draft")
        db.add(version)
    version.spec = body.spec
    version.notes = body.notes
    version.checksum = checksum
    db.commit()
    db.refresh(version)
    return version


@router.get("/bundles/{bundle_id}/versions", response_model=list[BundleVersionOut])
def list_versions(request: Request, bundle_id: str, db: Session = Depends(get_db),
                  _=Depends(require("api:bundle.read"))):
    bundle = _bundle_du_perimetre(db, bundle_id, request_organisation_id(request))
    return sorted(bundle.versions, key=lambda version: version.numero, reverse=True)


@router.get("/versions/{version_id}", response_model=BundleVersionDetailOut)
def get_version(request: Request, version_id: str, db: Session = Depends(get_db),
                _=Depends(require("api:bundle.read"))):
    return _version_du_perimetre(db, version_id, request_organisation_id(request))


@router.get("/versions/{version_id}/manifest")
def get_version_manifest(request: Request, version_id: str, db: Session = Depends(get_db),
                         _=Depends(require("api:bundle.read"))):
    """Ce que le robot recevra, tel qu'il le recevra."""
    version = _version_du_perimetre(db, version_id, request_organisation_id(request))
    manifeste = manifeste_runtime(version.spec)
    return {"checksum": empreinte(manifeste), "manifest": manifeste}


@router.post("/bundles/{bundle_id}/validate", response_model=BundleValidationOut)
def validate_bundle(request: Request, bundle_id: str, db: Session = Depends(get_db),
                    _=Depends(require("api:bundle.read"))):
    bundle = _bundle_du_perimetre(db, bundle_id, request_organisation_id(request))
    version = _brouillon(bundle) or _derniere_publiee(bundle)
    if version is None:
        raise HTTPException(409, "Ce bundle n'a aucune composition à vérifier")
    erreurs, avertissements = valider_specification(version.spec)
    return {"valide": not erreurs, "erreurs": erreurs, "avertissements": avertissements}


@router.post("/bundles/{bundle_id}/publish", response_model=BundleVersionOut)
def publish_bundle(request: Request, bundle_id: str, body: BundlePublishIn,
                   db: Session = Depends(get_db),
                   user=Depends(require("api:bundle.publish", "execute"))):
    bundle = _bundle_du_perimetre(db, bundle_id, request_organisation_id(request))
    version = _brouillon(bundle)
    if version is None:
        raise HTTPException(409, "Aucun brouillon à publier : modifiez la composition d'abord")
    if "expected_revision" in body.model_fields_set and body.expected_revision != version.editing_revision:
        raise HTTPException(409, "Le brouillon a changé depuis la vérification : vérifiez-le de nouveau")
    erreurs, _avertissements = valider_specification(version.spec)
    if erreurs:
        raise HTTPException(409, "Composition non publiable : " + " ; ".join(erreurs))
    _verifier_boites(db, version.spec, bundle.org_id)
    version.statut = "published"
    version.checksum = empreinte(manifeste_runtime(version.spec))
    version.notes = body.notes or version.notes
    version.published_at = _maintenant()
    version.published_by = user.id
    db.commit()
    db.refresh(version)
    write_audit(db, actor=user, action="BUNDLE_PUBLISH",
                resource=f"{bundle.nom} v{version.numero}", org_id=bundle.org_id)
    return version


# --------------------------------------------------------------------------- #
#  Déploiements
# --------------------------------------------------------------------------- #
@router.get("/deployments", response_model=list[DeploymentOut])
def list_deployments(request: Request, robot_id: str | None = None, bundle_id: str | None = None,
                     statut: str | None = None, db: Session = Depends(get_db),
                     _=Depends(require("api:deployment.read"))):
    if sans_perimetre(request):
        return []
    query = (
        select(BundleDeployment, BundleVersion, DeploymentBundle, Robot)
        .join(BundleVersion, BundleVersion.id == BundleDeployment.version_id)
        .join(DeploymentBundle, DeploymentBundle.id == BundleVersion.bundle_id)
        .join(Robot, Robot.id == BundleDeployment.robot_id)
    )
    org_id = request_organisation_id(request)
    if org_id:
        query = query.where(BundleDeployment.org_id == org_id)
    if robot_id:
        query = query.where(BundleDeployment.robot_id == robot_id)
    if bundle_id:
        query = query.where(DeploymentBundle.id == bundle_id)
    if statut:
        query = query.where(BundleDeployment.statut == statut)
    # Deux demandes peuvent porter le meme horodatage a la seconde pres. On
    # departage alors par l'etat : ce qui vaut encore pour le robot se lit en
    # premier, l'historique remplace ensuite.
    effectif = case((BundleDeployment.statut.in_(EN_COURS), 0), else_=1)
    lignes = db.execute(
        query.order_by(BundleDeployment.created_at.desc(), effectif, BundleDeployment.id)
    ).all()
    return [_deployment_out(deployment, version, bundle, robot)
            for deployment, version, bundle, robot in lignes]


@router.post("/deployments", response_model=list[DeploymentOut], status_code=201)
def create_deployment(request: Request, body: DeploymentIn, db: Session = Depends(get_db),
                      user=Depends(require("api:deployment.execute", "execute"))):
    """Demande l'application d'une version sur un robot ou une flotte.

    Déployer sur une flotte crée une ligne par robot : c'est le robot qui
    applique, et c'est robot par robot que l'on veut savoir si ça a marché.
    """
    org_id = request_organisation_id(request)
    version = _version_du_perimetre(db, body.version_id, org_id)
    if version.statut != "published":
        raise HTTPException(409, "Seule une version publiée peut être déployée")
    bundle = db.get(DeploymentBundle, version.bundle_id)
    assert bundle is not None  # garanti par _version_du_perimetre

    cibles = list(dict.fromkeys(body.robot_ids))
    if body.fleet_id:
        flotte = db.get(Fleet, body.fleet_id)
        if not flotte or (org_id and flotte.org_id != org_id):
            raise HTTPException(404, "Flotte introuvable")
        cibles += [
            lien.robot_id for lien in
            db.execute(select(FleetRobot).where(FleetRobot.fleet_id == flotte.id)).scalars()
        ]
        cibles = list(dict.fromkeys(cibles))
    if not cibles:
        raise HTTPException(400, "Choisissez au moins un robot")

    robots = [_robot_du_perimetre(db, robot_id, org_id) for robot_id in cibles]
    if any(robot.org_id != bundle.org_id for robot in robots):
        raise HTTPException(409, "Un robot ciblé n'appartient pas à l'organisation du bundle")

    crees: list[BundleDeployment] = []
    boites_appliquees: list[str] = []
    for robot in robots:
        precedents = db.execute(
            select(BundleDeployment)
            .where(BundleDeployment.robot_id == robot.id)
            .where(BundleDeployment.statut.in_(EN_COURS))
        ).scalars().all()
        for precedent in precedents:
            precedent.statut = "superseded"
        deployment = BundleDeployment(
            org_id=bundle.org_id, version_id=version.id, robot_id=robot.id,
            statut="pending", requested_by=user.id, message=body.message,
        )
        db.add(deployment)
        crees.append(deployment)
        boites_appliquees += _appliquer_boites(db, version, robot, bundle.org_id)
    db.commit()

    detail_boites = f", {len(set(boites_appliquees))} Box IA" if boites_appliquees else ""
    write_audit(db, actor=user, action="BUNDLE_DEPLOY",
                resource=f"{bundle.nom} v{version.numero} → {len(robots)} robot(s){detail_boites}",
                org_id=bundle.org_id)
    par_id = {robot.id: robot for robot in robots}
    return [_deployment_out(deployment, version, bundle, par_id.get(deployment.robot_id))
            for deployment in crees]


@router.post("/deployments/{deployment_id}/cancel", response_model=DeploymentOut)
def cancel_deployment(request: Request, deployment_id: str, db: Session = Depends(get_db),
                      user=Depends(require("api:deployment.execute", "execute"))):
    deployment = db.get(BundleDeployment, deployment_id)
    org_id = request_organisation_id(request)
    if not deployment or (org_id and deployment.org_id != org_id):
        raise HTTPException(404, "Déploiement introuvable")
    if deployment.statut != "pending":
        raise HTTPException(409, "Seul un déploiement non encore récupéré peut être annulé")
    deployment.statut = "superseded"
    db.commit()
    db.refresh(deployment)
    version = db.get(BundleVersion, deployment.version_id)
    bundle = db.get(DeploymentBundle, version.bundle_id) if version else None
    robot = db.get(Robot, deployment.robot_id)
    write_audit(db, actor=user, action="BUNDLE_DEPLOY_CANCEL",
                resource=robot.nom if robot else deployment.robot_id, org_id=deployment.org_id)
    return _deployment_out(deployment, version, bundle, robot)


# --------------------------------------------------------------------------- #
#  Runtime : l'agent embarqué tire sa configuration
# --------------------------------------------------------------------------- #
def _cle_presentee(x_oscar_agent_key: str | None = Header(default=None)) -> str:
    """Clé portée par l'agent embarqué, exigée avant toute résolution de robot."""
    if not x_oscar_agent_key:
        raise HTTPException(401, "Clé agent embarqué absente")
    return x_oscar_agent_key


def _robot_par_reference(db: Session, reference: str) -> Robot:
    """Résout un robot par son UUID ou par son slug.

    L'agent embarqué ne connaît que le slug inscrit dans son enrôlement ; la
    console manipule l'UUID. Accepter les deux ici évite de propager cette
    dualité dans le reste du système.
    """
    robot = db.get(Robot, reference)
    if robot is None:
        robot = db.execute(select(Robot).where(Robot.slug == reference)).scalar_one_or_none()
    if robot is None:
        raise HTTPException(404, "Robot introuvable")
    return robot


def _robot_authentifie(db: Session, reference: str, cle: str) -> Robot:
    """Le robot désigné, à condition que la clé présentée soit la sienne.

    Une clé unique pour toute la flotte laissait un robot compromis lire les
    déploiements de ses voisins et rendre compte à leur place. Chaque robot
    porte donc sa propre clé, dont le serveur ne connaît que l'empreinte.

    Transition : un robot qui n'a pas encore reçu la sienne accepte encore la
    clé de flotte, pour qu'un parc en cours de migration continue de
    fonctionner. Dès qu'un robot a sa clé, celle de flotte ne vaut plus rien
    pour lui.
    """
    robot = _robot_par_reference(db, reference)
    if robot.agent_key_hash:
        empreinte = hashlib.sha256(cle.encode("utf-8")).hexdigest()
        if not hmac.compare_digest(empreinte, robot.agent_key_hash):
            raise HTTPException(401, "Clé agent embarqué invalide pour ce robot")
        return robot
    flotte = settings.edge_agent_api_key
    if not flotte:
        raise HTTPException(503, "Aucune clé d'agent émise pour ce robot")
    if not hmac.compare_digest(cle, flotte):
        raise HTTPException(401, "Clé agent embarqué invalide")
    return robot


@router.get("/runtime/robots/{reference}/bundle")
def runtime_bundle(reference: str, db: Session = Depends(get_db),
                   cle: str = Depends(_cle_presentee)):
    """Manifeste que ce robot doit appliquer, ou rien s'il est à jour."""
    robot = _robot_authentifie(db, reference, cle)
    deployment = db.execute(
        select(BundleDeployment)
        .where(BundleDeployment.robot_id == robot.id)
        .where(BundleDeployment.statut.in_(EN_COURS))
        .order_by(BundleDeployment.created_at.desc())
    ).scalars().first()
    if deployment is None:
        return {"format": RUNTIME_FORMAT, "robot": robot.slug or robot.id, "deployment": None}

    version = db.get(BundleVersion, deployment.version_id)
    bundle = db.get(DeploymentBundle, version.bundle_id) if version else None
    manifeste = manifeste_runtime(version.spec if version else {})
    if deployment.statut == "pending":
        deployment.statut = "delivered"
        deployment.delivered_at = _maintenant()
        db.commit()
    return {
        "format": RUNTIME_FORMAT,
        "robot": robot.slug or robot.id,
        "deployment": {
            "id": deployment.id,
            "statut": deployment.statut,
            "bundle": bundle.slug if bundle else None,
            "version": version.numero if version else None,
            "checksum": empreinte(manifeste),
        },
        "manifest": manifeste,
    }


@router.post("/runtime/robots/{reference}/bundle/report")
def runtime_report(reference: str, body: DeploymentReportIn, db: Session = Depends(get_db),
                   cle: str = Depends(_cle_presentee)):
    """Compte rendu de l'agent : appliqué, ou échoué avec sa raison."""
    robot = _robot_authentifie(db, reference, cle)
    deployment = db.get(BundleDeployment, body.deployment_id)
    if not deployment or deployment.robot_id != robot.id:
        raise HTTPException(404, "Déploiement introuvable pour ce robot")
    if deployment.statut == "superseded":
        raise HTTPException(409, "Ce déploiement a été remplacé : rapport obsolète")
    version = db.get(BundleVersion, deployment.version_id)
    attendu = empreinte(manifeste_runtime(version.spec if version else {}))
    if not body.checksum or not hmac.compare_digest(body.checksum, attendu):
        # Le robot rend compte d'autre chose que ce qui lui a été servi : on
        # le consigne comme un échec plutôt que de valider une version qui ne
        # correspond à rien de publié.
        deployment.statut = "failed"
        deployment.message = "Empreinte du manifeste appliqué différente de celle publiée"
        deployment.report = body.report
        db.commit()
        raise HTTPException(409, "Empreinte du manifeste inattendue")
    deployment.statut = body.statut
    deployment.message = body.message
    deployment.report = body.report
    deployment.applied_at = _maintenant() if body.statut == "active" else None
    db.commit()
    return {"deployment": deployment.id, "statut": deployment.statut}


# --------------------------------------------------------------------------- #
#  Runtime : le paquet embarqué lui-même
# --------------------------------------------------------------------------- #
def _release_attendue(db: Session, robot: Robot) -> EdgeRelease | None:
    from .releases import _release_du_canal

    return _release_du_canal(db, robot.edge_channel or "stable")


@router.get("/runtime/robots/{reference}/release")
def runtime_release(reference: str, version: str = "", db: Session = Depends(get_db),
                    cle: str = Depends(_cle_presentee)):
    """Version du paquet embarqué que ce robot devrait exécuter.

    Le robot annonce celle qu'il a ; la console répond ce qu'elle attend, avec
    l'empreinte de l'archive et une signature de cette empreinte par la clé du
    robot. Sans cette signature, un intermédiaire pourrait annoncer une archive
    qu'il aurait lui-même fabriquée.
    """
    from .releases import _empreinte_signee

    robot = _robot_authentifie(db, reference, cle)
    if version and robot.edge_version != version:
        robot.edge_version = version
        db.commit()

    release = _release_attendue(db, robot)
    if release is None or release.version == version:
        return {"canal": robot.edge_channel, "installee": version or None, "release": None}
    return {
        "canal": robot.edge_channel,
        "installee": version or None,
        "release": {
            "version": release.version,
            "sha256": release.sha256,
            "taille": release.taille,
            "notes": release.notes,
            "empreinte_signee": _empreinte_signee(release.sha256, robot.agent_key_hash or ""),
        },
    }


@router.get("/runtime/robots/{reference}/release/archive")
def runtime_release_archive(reference: str, db: Session = Depends(get_db),
                            cle: str = Depends(_cle_presentee)):
    """Sert l'archive attendue pour ce robot, et rien d'autre."""
    robot = _robot_authentifie(db, reference, cle)
    release = _release_attendue(db, robot)
    if release is None:
        raise HTTPException(404, "Aucun paquet publié sur ce canal")
    chemin = Path(release.fichier)
    if not chemin.exists():
        raise HTTPException(410, "Archive absente du stockage")
    return FileResponse(chemin, filename=f"oscar-edge-{release.version}.tar.gz",
                        media_type="application/gzip")


@router.post("/runtime/robots/{reference}/release/report")
def runtime_release_report(reference: str, body: EdgeReleaseReportIn,
                           db: Session = Depends(get_db), cle: str = Depends(_cle_presentee)):
    """Résultat de l'installation, y compris un retour arrière assumé.

    C'est le robot qui sait si la version démarre ; la console enregistre ce
    qu'il déclare tourner, pas ce qu'elle espérait.
    """
    robot = _robot_authentifie(db, reference, cle)
    robot.edge_version = body.version
    db.commit()
    write_audit(db, actor=None, action="EDGE_RELEASE_" + body.statut.upper(),
                resource=f"{robot.nom} → {body.version}" + (f" : {body.message}" if body.message else ""),
                org_id=robot.org_id)
    return {"robot": robot.slug or robot.id, "version": body.version, "statut": body.statut}
