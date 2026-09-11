import hashlib
import hmac
import json
import re
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import request_organisation_id, require, write_audit
from ..livekit_rooms import robot_room
from ..models import AiModel, AiModelDeployment, DetectionCategory, Organisation, Robot
from ..schemas import CategoryIn, CategoryOut, ModelDeploymentIn, ModelDeploymentOut, ModelOut, ModelPromoteIn
from ..security import create_livekit_token

router = APIRouter(prefix="/ai", tags=["sandbox-ia"])

SUPPORTED_ARTIFACTS = {
    ".pt": "ultralytics",
    ".onnx": "onnxruntime",
    ".engine": "tensorrt",
    ".torchscript": "torchscript",
    ".tflite": "tflite",
}
SUPPORTED_TASKS = {
    "object_detection", "product_detection", "person_detection", "incident_detection",
    "classification", "segmentation", "pose", "anomaly_detection",
}
EXECUTABLE_RUNTIMES = {"ultralytics", "pytorch"}
EXECUTABLE_TASKS = {
    "object_detection", "product_detection", "person_detection", "incident_detection",
}


def _is_deployable(model: AiModel) -> bool:
    return model.runtime in EXECUTABLE_RUNTIMES and model.tache in EXECUTABLE_TASKS


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-") or "model"


def _scoped_model(db: Session, model_id: str, org_id: str | None) -> AiModel:
    model = db.get(AiModel, model_id)
    if not model or (org_id and model.org_id not in (None, org_id)):
        raise HTTPException(404, "Modèle introuvable")
    return model


def _scoped_robot(db: Session, robot_id: str, org_id: str | None) -> Robot:
    robot = db.get(Robot, robot_id)
    if not robot or (org_id and robot.org_id != org_id):
        raise HTTPException(404, "Robot introuvable")
    if not robot.org_id:
        raise HTTPException(409, "Le robot doit être rattaché à une organisation")
    return robot


def _worker_authorized(x_oscar_worker_key: str | None = Header(default=None)) -> None:
    expected = settings.perception_worker_api_key
    if not expected:
        raise HTTPException(503, "Accès worker IA non configuré")
    if not x_oscar_worker_key or not hmac.compare_digest(x_oscar_worker_key, expected):
        raise HTTPException(401, "Clé worker IA invalide")


def _parse_labels(raw: str) -> list[str]:
    try:
        value = json.loads(raw or "[]")
    except json.JSONDecodeError as exc:
        raise HTTPException(400, "labels_json doit être un tableau JSON") from exc
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise HTTPException(400, "labels_json doit contenir uniquement des libellés texte")
    return [item.strip() for item in value if item.strip()]


@router.get("/models", response_model=list[ModelOut])
def list_models(request: Request, db: Session = Depends(get_db), _=Depends(require("api:ai.model.read"))):
    org_id = request_organisation_id(request)
    query = select(AiModel).order_by(AiModel.created_at.desc())
    if org_id:
        query = query.where(or_(AiModel.org_id == org_id, AiModel.org_id.is_(None)))
    return db.execute(query).scalars().all()


@router.post("/models", response_model=ModelOut, status_code=201)
def upload_model(
    request: Request,
    nom: str = Form(..., min_length=2, max_length=160),
    version: str = Form(..., min_length=1, max_length=40),
    tache: str = Form("object_detection"),
    framework: str | None = Form(None),
    runtime: str | None = Form(None),
    description: str | None = Form(None),
    input_width: int = Form(640),
    input_height: int = Form(640),
    color_space: str = Form("RGB"),
    labels_json: str = Form("[]"),
    trusted_artifact: bool = Form(False),
    org_id: str | None = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user=Depends(require("api:ai.model.upload", "execute")),
):
    active_org_id = request_organisation_id(request)
    target_org_id = active_org_id or (org_id if user.is_superadmin else None)
    if not target_org_id or not db.get(Organisation, target_org_id):
        raise HTTPException(400, "Sélectionnez une organisation avant l'import")
    if tache not in SUPPORTED_TASKS:
        raise HTTPException(400, f"Tâche non supportée : {tache}")

    original_name = Path(file.filename or "").name
    extension = Path(original_name).suffix.lower()
    expected_runtime = SUPPORTED_ARTIFACTS.get(extension)
    if not expected_runtime:
        raise HTTPException(415, "Format non supporté. Utilisez .pt, .onnx, .engine, .torchscript ou .tflite")
    effective_runtime = (runtime or framework or expected_runtime).lower()
    if extension in {".pt", ".torchscript"} and not (trusted_artifact and user.is_superadmin):
        raise HTTPException(415, "Les artefacts PyTorch sérialisés exigent une validation Super Admin. Préférez ONNX pour les imports clients")
    if extension == ".pt" and effective_runtime not in ("ultralytics", "pytorch"):
        raise HTTPException(400, "Un fichier .pt doit utiliser le runtime Ultralytics/PyTorch")
    if extension != ".pt" and effective_runtime != expected_runtime:
        raise HTTPException(400, f"Le fichier {extension} doit utiliser le runtime {expected_runtime}")
    if input_width < 32 or input_height < 32 or input_width > 4096 or input_height > 4096:
        raise HTTPException(400, "Dimensions d'entrée invalides")

    labels = _parse_labels(labels_json)
    model_id = uuid.uuid4().hex
    artifact_dir = Path(settings.model_storage_dir) / target_org_id / model_id
    artifact_dir.mkdir(parents=True, exist_ok=False)
    artifact_path = artifact_dir / f"{_slug(nom)}-{_slug(version)}{extension}"
    max_bytes = settings.model_max_upload_mb * 1024 * 1024
    size = 0
    digest = hashlib.sha256()
    try:
        with artifact_path.open("wb") as output:
            while chunk := file.file.read(1024 * 1024):
                size += len(chunk)
                if size > max_bytes:
                    raise HTTPException(413, f"Le modèle dépasse {settings.model_max_upload_mb} Mo")
                digest.update(chunk)
                output.write(chunk)

        model = AiModel(
            id=model_id,
            org_id=target_org_id,
            nom=nom.strip(), version=version.strip(), tache=tache,
            framework=framework or effective_runtime, runtime=effective_runtime,
            description=description.strip() if description else None,
            fichier=str(artifact_path), artifact_name=original_name or artifact_path.name,
            artifact_sha256=digest.hexdigest(), artifact_size=size,
            artifact_trusted=trusted_artifact,
            statut="sandbox", validation_status="manifest_valid", validation_errors=[],
            input_spec={"width": input_width, "height": input_height, "color_space": color_space.upper()},
            output_spec={"coordinates": "normalized_xyxy", "topic": "oscar.vision.overlay"},
            labels=labels, metrics={},
        )
        db.add(model)
        db.commit()
    except HTTPException:
        artifact_path.unlink(missing_ok=True)
        artifact_dir.rmdir()
        raise
    except IntegrityError as exc:
        db.rollback()
        artifact_path.unlink(missing_ok=True)
        artifact_dir.rmdir()
        raise HTTPException(409, "Cette version du modèle existe déjà dans l'organisation") from exc

    db.refresh(model)
    write_audit(db, actor=user, action="MODEL_UPLOAD", resource=f"{nom} {version}", result="sandbox")
    return model


@router.post("/models/{model_id}/promote", response_model=ModelOut)
def promote_model(request: Request, model_id: str, body: ModelPromoteIn, db: Session = Depends(get_db),
                  user=Depends(require("api:ai.model.promote", "execute"))):
    model = _scoped_model(db, model_id, request_organisation_id(request))
    if body.statut not in ("sandbox", "production", "archive"):
        raise HTTPException(400, "Statut invalide")
    if body.statut == "production" and (
        model.validation_status != "manifest_valid" or not model.fichier or not model.artifact_sha256
    ):
        raise HTTPException(409, "Le modèle doit posséder un artefact validé avant sa promotion")
    model.statut = body.statut
    db.commit()
    db.refresh(model)
    write_audit(db, actor=user, action="MODEL_PROMOTE", resource=f"{model.nom}->{body.statut}")
    return model


@router.get("/deployments", response_model=list[ModelDeploymentOut])
def list_deployments(request: Request, robot_id: str | None = None, db: Session = Depends(get_db),
                     _=Depends(require("api:ai.model.read"))):
    org_id = request_organisation_id(request)
    query = select(AiModelDeployment).order_by(AiModelDeployment.created_at.desc())
    if org_id:
        query = query.where(AiModelDeployment.org_id == org_id)
    if robot_id:
        _scoped_robot(db, robot_id, org_id)
        query = query.where(AiModelDeployment.robot_id == robot_id)
    return db.execute(query).scalars().all()


@router.put("/models/{model_id}/deployments/{robot_id}", response_model=ModelDeploymentOut)
def configure_deployment(request: Request, model_id: str, robot_id: str, body: ModelDeploymentIn,
                         db: Session = Depends(get_db),
                         user=Depends(require("api:ai.model.deploy", "execute"))):
    org_id = request_organisation_id(request)
    model = _scoped_model(db, model_id, org_id)
    robot = _scoped_robot(db, robot_id, org_id)
    if model.org_id not in (None, robot.org_id):
        raise HTTPException(409, "Le modèle et le robot appartiennent à des organisations différentes")
    if body.enabled and (
        model.statut != "production" or model.validation_status != "manifest_valid" or not model.fichier
    ):
        raise HTTPException(409, "Promouvez un artefact validé en production avant de l'activer")
    if body.enabled and not _is_deployable(model):
        raise HTTPException(
            409,
            f"Aucun adaptateur de production n'est disponible pour {model.runtime}/{model.tache}",
        )

    deployment = db.execute(select(AiModelDeployment).where(
        AiModelDeployment.model_id == model.id,
        AiModelDeployment.robot_id == robot.id,
    )).scalar_one_or_none()
    if not deployment:
        deployment = AiModelDeployment(org_id=robot.org_id, model_id=model.id, robot_id=robot.id)
        db.add(deployment)
    for key, value in body.model_dump().items():
        setattr(deployment, key, value)
    db.commit()
    db.refresh(deployment)
    write_audit(db, actor=user, action="MODEL_DEPLOYMENT_UPDATE",
                resource=f"{model.nom}@{robot.nom}:{'on' if body.enabled else 'off'}")
    return deployment


@router.get("/runtime/robots/{robot_id}/manifest")
def runtime_manifest(robot_id: str, db: Session = Depends(get_db), _=Depends(_worker_authorized)):
    robot = db.get(Robot, robot_id)
    if not robot:
        raise HTTPException(404, "Robot introuvable")
    rows = db.execute(
        select(AiModelDeployment, AiModel).join(AiModel, AiModel.id == AiModelDeployment.model_id).where(
            AiModelDeployment.robot_id == robot_id,
            AiModelDeployment.enabled.is_(True),
            AiModel.statut == "production",
            AiModel.validation_status == "manifest_valid",
            AiModel.runtime.in_(EXECUTABLE_RUNTIMES),
            AiModel.tache.in_(EXECUTABLE_TASKS),
        )
    ).all()
    return {
        "schema_version": "1.0", "robot_id": robot.id,
        "room": robot_room(robot),
        "overlay_topic": "oscar.vision.overlay",
        "models": [{
            "id": model.id, "name": model.nom, "version": model.version, "task": model.tache,
            "runtime": model.runtime, "sha256": model.artifact_sha256,
            "artifact_name": model.artifact_name,
            "artifact_path": f"/api/ai/runtime/models/{model.id}/artifact",
            "input": model.input_spec, "output": model.output_spec, "labels": model.labels,
            "inference_fps": deployment.inference_fps, "confidence": deployment.confidence / 100,
            "iou_threshold": deployment.iou_threshold / 100,
            "overlay_enabled": deployment.overlay_enabled, "incident_enabled": deployment.incident_enabled,
            "config": deployment.config,
        } for deployment, model in rows],
    }


@router.get("/runtime/robots/{robot_id}/session")
def runtime_session(robot_id: str, db: Session = Depends(get_db), _=Depends(_worker_authorized)):
    """Issue a least-privilege LiveKit session to the perception worker."""
    robot = db.get(Robot, robot_id)
    if not robot:
        raise HTTPException(404, "Robot introuvable")
    room = robot_room(robot)
    identity = f"vision-{robot.id[:8]}-{uuid.uuid4().hex[:8]}"
    token = create_livekit_token(
        identity,
        room,
        can_publish=False,
        can_subscribe=True,
        can_publish_data=True,
        ttl_hours=settings.livekit_robot_ttl_hours,
        name=f"Vision · {robot.nom}",
    )
    return {
        "livekit_url": settings.livekit_url,
        "room": room,
        "identity": identity,
        "token": token,
        "expires_in_seconds": settings.livekit_robot_ttl_hours * 3600,
    }


@router.get("/runtime/models/{model_id}/artifact")
def download_runtime_artifact(model_id: str, db: Session = Depends(get_db), _=Depends(_worker_authorized)):
    model = db.get(AiModel, model_id)
    if not model or model.statut != "production" or not model.fichier:
        raise HTTPException(404, "Artefact introuvable")
    path = Path(model.fichier)
    if not path.is_file():
        raise HTTPException(410, "Artefact absent du stockage")
    return FileResponse(path, filename=model.artifact_name or path.name, media_type="application/octet-stream")


@router.get("/categories", response_model=list[CategoryOut])
def list_categories(request: Request, db: Session = Depends(get_db),
                    _=Depends(require("api:ai.category.write"))):
    org_id = request_organisation_id(request)
    query = select(DetectionCategory).order_by(DetectionCategory.label)
    if org_id:
        query = query.where(or_(DetectionCategory.org_id == org_id, DetectionCategory.org_id.is_(None)))
    return db.execute(query).scalars().all()


@router.post("/categories", response_model=CategoryOut, status_code=201)
def create_category(request: Request, body: CategoryIn, db: Session = Depends(get_db),
                    user=Depends(require("api:ai.category.write", "create"))):
    data = body.model_dump()
    data["org_id"] = request_organisation_id(request) or data.get("org_id")
    cat = DetectionCategory(**data)
    db.add(cat)
    db.commit()
    db.refresh(cat)
    write_audit(db, actor=user, action="CATEGORY_CREATE", resource=cat.label)
    return cat


@router.patch("/categories/{cat_id}", response_model=CategoryOut)
def update_category(request: Request, cat_id: str, body: CategoryIn, db: Session = Depends(get_db),
                    user=Depends(require("api:ai.category.write", "update"))):
    cat = db.get(DetectionCategory, cat_id)
    org_id = request_organisation_id(request)
    if not cat or (org_id and cat.org_id not in (None, org_id)):
        raise HTTPException(404, "Catégorie introuvable")
    for key, value in body.model_dump(exclude_unset=True, exclude={"org_id"}).items():
        setattr(cat, key, value)
    db.commit()
    db.refresh(cat)
    write_audit(db, actor=user, action="CATEGORY_UPDATE", resource=cat.label)
    return cat


@router.delete("/categories/{cat_id}", status_code=204)
def delete_category(request: Request, cat_id: str, db: Session = Depends(get_db),
                    user=Depends(require("api:ai.category.write", "delete"))):
    cat = db.get(DetectionCategory, cat_id)
    org_id = request_organisation_id(request)
    if not cat or (org_id and cat.org_id not in (None, org_id)):
        raise HTTPException(404, "Catégorie introuvable")
    db.delete(cat)
    db.commit()
    write_audit(db, actor=user, action="CATEGORY_DELETE", resource=cat.label)
