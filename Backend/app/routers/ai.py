import os
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import require, write_audit
from ..models import AiModel, DetectionCategory
from ..schemas import CategoryIn, CategoryOut, ModelOut, ModelPromoteIn

router = APIRouter(prefix="/ai", tags=["sandbox-ia"])


# ---- Modèles ---------------------------------------------------------------
@router.get("/models", response_model=list[ModelOut])
def list_models(db: Session = Depends(get_db), _=Depends(require("api:ai.model.read"))):
    return db.execute(select(AiModel).order_by(AiModel.created_at.desc())).scalars().all()


@router.post("/models", response_model=ModelOut, status_code=201)
def upload_model(
    nom: str = Form(...),
    version: str = Form(...),
    tache: str = Form("detection"),
    framework: str | None = Form(None),
    org_id: str | None = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user=Depends(require("api:ai.model.upload", "execute")),
):
    os.makedirs(settings.model_storage_dir, exist_ok=True)
    ext = os.path.splitext(file.filename or "")[1]
    path = os.path.join(settings.model_storage_dir, f"{uuid.uuid4().hex}{ext}")
    with open(path, "wb") as out:
        out.write(file.file.read())
    model = AiModel(
        nom=nom, version=version, tache=tache, framework=framework, org_id=org_id,
        fichier=path, statut="sandbox", metrics={},
    )
    db.add(model)
    db.commit()
    db.refresh(model)
    write_audit(db, actor=user, action="MODEL_UPLOAD", resource=f"{nom} {version}", result="sandbox")
    return model


@router.post("/models/{model_id}/promote", response_model=ModelOut)
def promote_model(model_id: str, body: ModelPromoteIn, db: Session = Depends(get_db),
                  user=Depends(require("api:ai.model.promote", "execute"))):
    model = db.get(AiModel, model_id)
    if not model:
        raise HTTPException(404, "Modèle introuvable")
    if body.statut not in ("sandbox", "production", "archive"):
        raise HTTPException(400, "Statut invalide")
    model.statut = body.statut
    db.commit()
    db.refresh(model)
    write_audit(db, actor=user, action="MODEL_PROMOTE", resource=f"{model.nom}->{body.statut}")
    return model


# ---- Catégories de détection ----------------------------------------------
@router.get("/categories", response_model=list[CategoryOut])
def list_categories(db: Session = Depends(get_db), _=Depends(require("api:ai.category.write"))):
    return db.execute(select(DetectionCategory).order_by(DetectionCategory.label)).scalars().all()


@router.post("/categories", response_model=CategoryOut, status_code=201)
def create_category(body: CategoryIn, db: Session = Depends(get_db),
                    user=Depends(require("api:ai.category.write", "create"))):
    cat = DetectionCategory(**body.model_dump())
    db.add(cat)
    db.commit()
    db.refresh(cat)
    write_audit(db, actor=user, action="CATEGORY_CREATE", resource=cat.label)
    return cat


@router.patch("/categories/{cat_id}", response_model=CategoryOut)
def update_category(cat_id: str, body: CategoryIn, db: Session = Depends(get_db),
                    user=Depends(require("api:ai.category.write", "update"))):
    cat = db.get(DetectionCategory, cat_id)
    if not cat:
        raise HTTPException(404, "Catégorie introuvable")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(cat, k, v)
    db.commit()
    db.refresh(cat)
    write_audit(db, actor=user, action="CATEGORY_UPDATE", resource=cat.label)
    return cat


@router.delete("/categories/{cat_id}", status_code=204)
def delete_category(cat_id: str, db: Session = Depends(get_db),
                    user=Depends(require("api:ai.category.write", "delete"))):
    cat = db.get(DetectionCategory, cat_id)
    if not cat:
        raise HTTPException(404, "Catégorie introuvable")
    db.delete(cat)
    db.commit()
    write_audit(db, actor=user, action="CATEGORY_DELETE", resource=cat.label)
