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
from sqlalchemy.orm import Session, selectinload

from ..config import settings
from ..database import get_db
from ..deps import request_organisation_id, require, write_audit
from ..livekit_rooms import robot_room
from ..models import (
    AiModel, AiModelBox, AiModelBoxAssignment, AiModelBoxItem, AiModelDeployment,
    DetectionCategory, Fleet, FleetRobot, ModelCategory, Organisation, Robot, Site,
)
from ..schemas import (
    CategoryIn, CategoryOut, ModelBoxAssignmentIn, ModelBoxAssignmentOut,
    ModelBoxCloneIn, ModelBoxIn, ModelBoxOut, ModelDeploymentIn,
    ModelDeploymentOut, ModelOut, ModelPromoteIn,
)
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


def raison_blocage(model: AiModel) -> str | None:
    """Pourquoi ce modele ne peut pas etre execute, ou None s'il peut.

    Source unique de la regle, servie avec chaque modele (`ModelOut.blocage`)
    pour que l'interface dise la meme chose que l'API au lieu de recopier la
    liste des runtimes. La condition etait jusqu'ici verifiee au dernier moment,
    a la publication : on pouvait donc composer une Box qui ne publierait
    jamais, et decouvrir le probleme apres coup.
    """
    if model.statut != "production":
        return f"statut « {model.statut} » : à promouvoir en production"
    if model.validation_status != "manifest_valid":
        return "manifeste non validé"
    if not model.fichier:
        return "aucun fichier de poids"
    if model.runtime not in EXECUTABLE_RUNTIMES:
        return (f"runtime « {model.runtime} » sans adaptateur "
                f"(disponibles : {', '.join(sorted(EXECUTABLE_RUNTIMES))})")
    if model.tache not in EXECUTABLE_TASKS:
        return (f"tâche « {model.tache} » inconnue du worker "
                f"(attendues : {', '.join(sorted(EXECUTABLE_TASKS))})")
    return None


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


def _parse_ids(raw: str, field: str) -> list[str]:
    try:
        value = json.loads(raw or "[]")
    except json.JSONDecodeError as exc:
        raise HTTPException(400, f"{field} doit être un tableau JSON") from exc
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise HTTPException(400, f"{field} doit contenir uniquement des identifiants")
    return list(dict.fromkeys(item for item in value if item))


def _parse_metrics(raw: str) -> dict:
    try:
        value = json.loads(raw or "{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(400, "metrics_json doit être un objet JSON") from exc
    if not isinstance(value, dict) or len(value) > 50:
        raise HTTPException(400, "metrics_json doit être un objet de 50 métriques maximum")
    if any(not isinstance(key, str) or not isinstance(metric, (int, float, str, bool, type(None)))
           for key, metric in value.items()):
        raise HTTPException(400, "Les métriques doivent être des valeurs JSON simples")
    return value


def _scoped_box(db: Session, box_id: str, org_id: str | None) -> AiModelBox:
    box = db.execute(
        select(AiModelBox).where(AiModelBox.id == box_id).options(
            selectinload(AiModelBox.items).selectinload(AiModelBoxItem.model),
            selectinload(AiModelBox.assignments),
        )
    ).scalar_one_or_none()
    if not box or (org_id and box.org_id != org_id):
        raise HTTPException(404, "Model Box introuvable")
    return box


def _box_out(box: AiModelBox) -> dict:
    return {
        "id": box.id, "org_id": box.org_id, "nom": box.nom, "version": box.version,
        "description": box.description, "statut": box.statut,
        "created_at": box.created_at, "updated_at": box.updated_at,
        "assignment_count": sum(1 for item in box.assignments if item.enabled),
        "items": [{
            "id": item.id, "model_id": item.model_id, "position": item.position,
            "inference_fps": item.inference_fps, "confidence": item.confidence,
            "iou_threshold": item.iou_threshold, "overlay_enabled": item.overlay_enabled,
            "incident_enabled": item.incident_enabled, "camera": item.camera,
            "config": item.config, "model_name": item.model.nom,
            "model_version": item.model.version, "model_runtime": item.model.runtime,
            "model_status": item.model.statut,
        } for item in box.items],
    }


def _validate_box_models(db: Session, body: ModelBoxIn, org_id: str) -> list[AiModel]:
    ids = [item.model_id for item in body.items]
    if len(ids) != len(set(ids)):
        raise HTTPException(400, "Un modèle ne peut apparaître qu'une fois dans une Box")
    models = db.execute(select(AiModel).where(AiModel.id.in_(ids))).scalars().all() if ids else []
    by_id = {model.id: model for model in models}
    if len(by_id) != len(ids):
        raise HTTPException(400, "Un modèle sélectionné est introuvable")
    if any(model.org_id not in (None, org_id) for model in models):
        raise HTTPException(409, "Tous les modèles doivent appartenir à l'organisation de la Box")
    bloques = [f"{model.nom} v{model.version} — {raison}" for model in models
               if (raison := raison_blocage(model))]
    if bloques:
        raise HTTPException(
            409,
            "Ces modèles ne peuvent pas être exécutés, retirez-les de la Box : "
            + " ; ".join(bloques),
        )
    return [by_id[model_id] for model_id in ids]


def _replace_box_items(box: AiModelBox, body: ModelBoxIn, db: Session | None = None) -> None:
    box.items.clear()
    if db is not None:
        # Purge les suppressions avant de reinserer. Sans ce flush, garder un
        # modele deja present fait inserer la nouvelle ligne avant la
        # suppression de l'ancienne : uq_ai_model_box_item_model saute, et
        # l'erreur remonte en « cette version existe deja ». Modifier une Box en
        # conservant l'un de ses modeles etait donc impossible.
        db.flush()
    for index, item in enumerate(body.items):
        data = item.model_dump()
        data["position"] = item.position if item.position else index
        box.items.append(AiModelBoxItem(**data))


@router.get("/models", response_model=list[ModelOut])
def list_models(request: Request, db: Session = Depends(get_db), _=Depends(require("api:ai.model.read"))):
    org_id = request_organisation_id(request)
    query = select(AiModel).order_by(AiModel.created_at.desc())
    if org_id:
        query = query.where(or_(AiModel.org_id == org_id, AiModel.org_id.is_(None)))
    return [_model_out(model) for model in db.execute(query).scalars()]


def _model_out(model: AiModel) -> ModelOut:
    sortie = ModelOut.model_validate(model)
    sortie.blocage = raison_blocage(model)
    sortie.deployable = sortie.blocage is None
    return sortie


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
    category_ids_json: str = Form("[]"),
    metrics_json: str = Form("{}"),
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
    category_ids = _parse_ids(category_ids_json, "category_ids_json")
    metrics = _parse_metrics(metrics_json)
    if category_ids:
        categories = db.execute(select(DetectionCategory).where(DetectionCategory.id.in_(category_ids))).scalars().all()
        if len(categories) != len(category_ids) or any(cat.org_id not in (None, target_org_id) for cat in categories):
            raise HTTPException(400, "Une catégorie sélectionnée est inconnue dans cette organisation")
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
            labels=labels, metrics=metrics,
        )
        db.add(model)
        db.flush()
        for category_id in category_ids:
            db.add(ModelCategory(model_id=model.id, category_id=category_id))
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


@router.delete("/models/{model_id}", status_code=204)
def delete_model(request: Request, model_id: str, db: Session = Depends(get_db),
                 user=Depends(require("api:ai.model.delete", "execute"))):
    """Retire definitivement un modele du catalogue, poids compris.

    Le catalogue n'avait aucune sortie : un import rate, un fichier de test, une
    tache inexecutable restaient la pour toujours et venaient polluer la
    composition des Box. La suppression est refusee tant qu'une Box reference le
    modele — y compris en brouillon — parce que casser une composition en
    silence est pire que demander de la modifier d'abord.
    """
    model = _scoped_model(db, model_id, request_organisation_id(request))
    boxes = db.execute(
        select(AiModelBox.nom, AiModelBox.version, AiModelBox.statut)
        .join(AiModelBoxItem, AiModelBoxItem.box_id == AiModelBox.id)
        .where(AiModelBoxItem.model_id == model.id)
    ).all()
    if boxes:
        details = ", ".join(f"{nom} v{version} ({statut})" for nom, version, statut in boxes)
        raise HTTPException(409, f"Modèle utilisé par : {details}. Retirez-le de ces Box d'abord")

    deploiements = db.execute(
        select(AiModelDeployment).where(AiModelDeployment.model_id == model.id)
    ).scalars().all()
    for deploiement in deploiements:
        db.delete(deploiement)

    chemin = Path(model.fichier) if model.fichier else None
    etiquette = f"{model.nom} v{model.version}"
    db.delete(model)
    db.commit()

    if chemin and chemin.is_file():
        # Les poids ne servent plus a personne : les garder occupe le volume et
        # laisse un artefact sans trace en base.
        chemin.unlink(missing_ok=True)
        try:
            chemin.parent.rmdir()
        except OSError:
            pass  # repertoire non vide : on laisse en place plutot que d'insister
    write_audit(db, actor=user, action="MODEL_DELETE", resource=etiquette)
    return None


@router.get("/model-boxes", response_model=list[ModelBoxOut])
def list_model_boxes(request: Request, db: Session = Depends(get_db),
                     _=Depends(require("api:ai.model.read"))):
    query = select(AiModelBox).options(
        selectinload(AiModelBox.items).selectinload(AiModelBoxItem.model),
        selectinload(AiModelBox.assignments),
    ).order_by(AiModelBox.created_at.desc())
    org_id = request_organisation_id(request)
    if org_id:
        query = query.where(AiModelBox.org_id == org_id)
    return [_box_out(box) for box in db.execute(query).scalars().unique().all()]


@router.post("/model-boxes", response_model=ModelBoxOut, status_code=201)
def create_model_box(request: Request, body: ModelBoxIn, db: Session = Depends(get_db),
                     user=Depends(require("api:ai.model.deploy", "execute"))):
    org_id = request_organisation_id(request)
    if not org_id:
        raise HTTPException(400, "Sélectionnez une organisation avant de créer une Box")
    _validate_box_models(db, body, org_id)
    box = AiModelBox(
        org_id=org_id, nom=body.nom.strip(), version=body.version.strip(),
        description=body.description.strip() if body.description else None,
    )
    _replace_box_items(box, body)
    db.add(box)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "Cette version de Model Box existe déjà") from exc
    box = _scoped_box(db, box.id, org_id)
    write_audit(db, actor=user, action="MODEL_BOX_CREATE", resource=f"{box.nom} {box.version}")
    return _box_out(box)


@router.patch("/model-boxes/{box_id}", response_model=ModelBoxOut)
def update_model_box(request: Request, box_id: str, body: ModelBoxIn, db: Session = Depends(get_db),
                     user=Depends(require("api:ai.model.deploy", "execute"))):
    org_id = request_organisation_id(request)
    box = _scoped_box(db, box_id, org_id)
    if box.statut != "draft":
        raise HTTPException(409, "Une Box publiée est immuable. Clonez-la pour créer une nouvelle version")
    _validate_box_models(db, body, box.org_id)
    box.nom, box.version = body.nom.strip(), body.version.strip()
    box.description = body.description.strip() if body.description else None
    _replace_box_items(box, body, db)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "Cette version de Model Box existe déjà") from exc
    box = _scoped_box(db, box.id, org_id)
    write_audit(db, actor=user, action="MODEL_BOX_UPDATE", resource=f"{box.nom} {box.version}")
    return _box_out(box)


@router.post("/model-boxes/{box_id}/publish", response_model=ModelBoxOut)
def publish_model_box(request: Request, box_id: str, db: Session = Depends(get_db),
                      user=Depends(require("api:ai.model.deploy", "execute"))):
    box = _scoped_box(db, box_id, request_organisation_id(request))
    if box.statut != "draft":
        raise HTTPException(409, "Seule une Box en brouillon peut être publiée")
    if not box.items:
        raise HTTPException(409, "Ajoutez au moins un modèle à la Box")
    bloques = [f"{item.model.nom} v{item.model.version} — {raison}" for item in box.items
               if (raison := raison_blocage(item.model))]
    if bloques:
        raise HTTPException(409, "Modèles non déployables : " + " ; ".join(bloques))
    box.statut = "published"
    db.commit()
    box = _scoped_box(db, box.id, box.org_id)
    write_audit(db, actor=user, action="MODEL_BOX_PUBLISH", resource=f"{box.nom} {box.version}")
    return _box_out(box)


@router.post("/model-boxes/{box_id}/clone", response_model=ModelBoxOut, status_code=201)
def clone_model_box(request: Request, box_id: str, body: ModelBoxCloneIn,
                    db: Session = Depends(get_db),
                    user=Depends(require("api:ai.model.deploy", "execute"))):
    source = _scoped_box(db, box_id, request_organisation_id(request))
    clone = AiModelBox(
        org_id=source.org_id, nom=source.nom, version=body.version.strip(),
        description=source.description, statut="draft",
    )
    for item in source.items:
        clone.items.append(AiModelBoxItem(
            model_id=item.model_id, position=item.position, inference_fps=item.inference_fps,
            confidence=item.confidence, iou_threshold=item.iou_threshold,
            overlay_enabled=item.overlay_enabled, incident_enabled=item.incident_enabled,
            camera=item.camera, config=item.config,
        ))
    db.add(clone)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "Cette version de Model Box existe déjà") from exc
    clone = _scoped_box(db, clone.id, clone.org_id)
    write_audit(db, actor=user, action="MODEL_BOX_CLONE", resource=f"{source.version}->{clone.version}")
    return _box_out(clone)


def _assignment_out(assignment: AiModelBoxAssignment, box: AiModelBox) -> dict:
    return {
        "id": assignment.id, "org_id": assignment.org_id, "box_id": assignment.box_id,
        "box_name": box.nom, "box_version": box.version,
        "robot_id": assignment.robot_id, "fleet_id": assignment.fleet_id,
        "site_id": assignment.site_id, "enabled": assignment.enabled,
        "created_at": assignment.created_at, "updated_at": assignment.updated_at,
    }


@router.get("/model-box-assignments", response_model=list[ModelBoxAssignmentOut])
def list_model_box_assignments(request: Request, db: Session = Depends(get_db),
                               _=Depends(require("api:ai.model.read"))):
    query = select(AiModelBoxAssignment, AiModelBox).join(
        AiModelBox, AiModelBox.id == AiModelBoxAssignment.box_id
    ).order_by(AiModelBoxAssignment.created_at.desc())
    org_id = request_organisation_id(request)
    if org_id:
        query = query.where(AiModelBoxAssignment.org_id == org_id)
    return [_assignment_out(assignment, box) for assignment, box in db.execute(query).all()]


@router.put(
    "/model-boxes/{box_id}/assignments/{target_type}/{target_id}",
    response_model=ModelBoxAssignmentOut,
)
def configure_model_box_assignment(request: Request, box_id: str, target_type: str, target_id: str,
                                   body: ModelBoxAssignmentIn, db: Session = Depends(get_db),
                                   user=Depends(require("api:ai.model.deploy", "execute"))):
    box = _scoped_box(db, box_id, request_organisation_id(request))
    if box.statut != "published":
        raise HTTPException(409, "Publiez la Box avant de l'affecter")
    targets = {"robot": Robot, "fleet": Fleet, "site": Site}
    target_model = targets.get(target_type)
    if not target_model:
        raise HTTPException(400, "Cible attendue : robot, fleet ou site")
    target = db.get(target_model, target_id)
    if not target or target.org_id != box.org_id:
        raise HTTPException(404, "Cible introuvable dans l'organisation de la Box")
    target_column = getattr(AiModelBoxAssignment, f"{target_type}_id")
    assignment = db.execute(select(AiModelBoxAssignment).where(
        AiModelBoxAssignment.box_id == box.id, target_column == target_id,
    )).scalar_one_or_none()
    if not assignment:
        assignment = AiModelBoxAssignment(
            org_id=box.org_id, box_id=box.id, **{f"{target_type}_id": target_id}
        )
        db.add(assignment)
    assignment.enabled = body.enabled
    db.commit()
    db.refresh(assignment)
    write_audit(db, actor=user, action="MODEL_BOX_ASSIGNMENT_UPDATE",
                resource=f"{box.nom}@{target_type}:{target_id}:{'on' if body.enabled else 'off'}")
    return _assignment_out(assignment, box)


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

    fleet_ids = set(db.execute(
        select(FleetRobot.fleet_id).where(FleetRobot.robot_id == robot.id)
    ).scalars())
    target_conditions = [AiModelBoxAssignment.robot_id == robot.id]
    if robot.site_id:
        target_conditions.append(AiModelBoxAssignment.site_id == robot.site_id)
    if fleet_ids:
        target_conditions.append(AiModelBoxAssignment.fleet_id.in_(fleet_ids))
    assignments = db.execute(
        select(AiModelBoxAssignment).where(
            AiModelBoxAssignment.org_id == robot.org_id,
            AiModelBoxAssignment.enabled.is_(True),
            or_(*target_conditions),
        )
    ).scalars().all()
    assignments.sort(
        key=lambda item: (3 if item.robot_id else 2 if item.fleet_id else 1, item.created_at),
        reverse=True,
    )

    selected: dict[str, dict] = {}
    active_boxes = []
    active_box_ids: set[str] = set()
    for assignment in assignments:
        box = db.execute(select(AiModelBox).where(
            AiModelBox.id == assignment.box_id, AiModelBox.statut == "published",
        ).options(selectinload(AiModelBox.items).selectinload(AiModelBoxItem.model))).scalar_one_or_none()
        if not box:
            continue
        if box.id not in active_box_ids:
            active_boxes.append({"id": box.id, "name": box.nom, "version": box.version})
            active_box_ids.add(box.id)
        for item in box.items:
            model = item.model
            if model.id in selected or model.statut != "production" or model.validation_status != "manifest_valid":
                continue
            if not model.fichier or not _is_deployable(model):
                continue
            selected[model.id] = {
                "id": model.id, "name": model.nom, "version": model.version, "task": model.tache,
                "runtime": model.runtime, "sha256": model.artifact_sha256,
                "artifact_name": model.artifact_name,
                "artifact_path": f"/api/ai/runtime/models/{model.id}/artifact",
                "input": model.input_spec, "output": model.output_spec, "labels": model.labels,
                "inference_fps": item.inference_fps, "confidence": item.confidence / 100,
                "iou_threshold": item.iou_threshold / 100,
                "overlay_enabled": item.overlay_enabled, "incident_enabled": item.incident_enabled,
                "camera": item.camera, "config": item.config,
                "box": {"id": box.id, "name": box.nom, "version": box.version},
            }

    # Backward compatibility for pre-Box assignments. New Studio flows only use Boxes.
    legacy_rows = db.execute(
        select(AiModelDeployment, AiModel).join(AiModel, AiModel.id == AiModelDeployment.model_id).where(
            AiModelDeployment.robot_id == robot_id,
            AiModelDeployment.enabled.is_(True),
            AiModel.statut == "production",
            AiModel.validation_status == "manifest_valid",
            AiModel.runtime.in_(EXECUTABLE_RUNTIMES),
            AiModel.tache.in_(EXECUTABLE_TASKS),
        )
    ).all()
    for deployment, model in legacy_rows:
        if model.id in selected:
            continue
        selected[model.id] = {
            "id": model.id, "name": model.nom, "version": model.version, "task": model.tache,
            "runtime": model.runtime, "sha256": model.artifact_sha256,
            "artifact_name": model.artifact_name,
            "artifact_path": f"/api/ai/runtime/models/{model.id}/artifact",
            "input": model.input_spec, "output": model.output_spec, "labels": model.labels,
            "inference_fps": deployment.inference_fps, "confidence": deployment.confidence / 100,
            "iou_threshold": deployment.iou_threshold / 100,
            "overlay_enabled": deployment.overlay_enabled, "incident_enabled": deployment.incident_enabled,
            "camera": "primary", "config": deployment.config, "legacy_direct_assignment": True,
        }
    return {
        "schema_version": "1.1", "robot_id": robot.id,
        "room": robot_room(robot),
        "overlay_topic": "oscar.vision.overlay",
        "active_boxes": active_boxes,
        "models": list(selected.values()),
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
