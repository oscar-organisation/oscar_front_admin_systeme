"""Catalogue de compositions de référence, livré et maintenu par la plateforme.

Le Studio proposait déjà un point de départ à la création d'un projet, mais
ces départs étaient trois formes génériques écrites en dur dans le navigateur.
Ils ne savaient rien des châssis réellement pris en charge, et une composition
éprouvée sur un robot ne pouvait pas servir au suivant.

Un préset comble cet écart. Il n'appartient à aucune organisation : c'est là
toute sa différence avec un bundle. Un bundle est le travail d'un client sur
ses robots ; un préset est un point de départ que nous maintenons et que tous
voient. La bibliothèque s'enrichit un châssis à la fois — ROSMASTER
aujourd'hui, un autre demain.

D'où une conséquence que le code applique plutôt que de la confier au réglage
des rôles : écrire dans ce catalogue est réservé au super administrateur. Une
composition fautive s'y propagerait à tous les projets créés ensuite, dans
toutes les organisations.
"""

import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require, write_audit
from ..models import BundleVersion, CompositionPreset, DeploymentBundle, User
from ..schemas import CompositionPresetIn, CompositionPresetOut, CompositionPresetPatch

router = APIRouter(prefix="/studio/presets", tags=["studio-presets"])

SLUG_VALIDE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
STATUTS = ("draft", "published", "archived")


def _catalogue_ecrivable(user: User) -> User:
    """Le catalogue est global : seul le super administrateur y écrit.

    La permission `api:preset.write` dit qu'un rôle a la capacité ; cette
    vérification-ci dit qu'il a la portée. Un administrateur d'organisation
    peut légitimement tout faire chez lui sans pour autant décider de ce que
    les autres organisations verront proposé.
    """
    if not user.is_superadmin:
        raise HTTPException(403, "Le catalogue de présets est maintenu par la plateforme")
    return user


def _preset(db: Session, reference: str) -> CompositionPreset:
    """Résout un préset par son identifiant ou par son slug."""
    preset = db.execute(
        select(CompositionPreset).where(
            (CompositionPreset.id == reference) | (CompositionPreset.slug == reference)
        )
    ).scalar_one_or_none()
    if preset is None:
        raise HTTPException(404, "Préset inconnu")
    return preset


@router.get("", response_model=list[CompositionPresetOut])
def list_presets(famille: str = "", tous: bool = False, db: Session = Depends(get_db),
                 user=Depends(require("api:preset.read"))):
    """Catalogue visible depuis le Studio.

    Seuls les présets publiés remontent par défaut : un brouillon en cours de
    mise au point n'a rien à faire dans le sélecteur d'un client. `tous` lève
    ce filtre, et n'est honoré que pour un super administrateur.
    """
    requete = select(CompositionPreset)
    if not (tous and user.is_superadmin):
        requete = requete.where(CompositionPreset.statut == "published")
    if famille:
        requete = requete.where(CompositionPreset.famille == famille)
    return db.execute(
        requete.order_by(CompositionPreset.ordre, CompositionPreset.nom)
    ).scalars().all()


@router.get("/{reference}", response_model=CompositionPresetOut)
def get_preset(reference: str, db: Session = Depends(get_db),
               user=Depends(require("api:preset.read"))):
    preset = _preset(db, reference)
    if preset.statut != "published" and not user.is_superadmin:
        raise HTTPException(404, "Préset inconnu")
    return preset


@router.post("", response_model=CompositionPresetOut, status_code=201)
def create_preset(body: CompositionPresetIn, db: Session = Depends(get_db),
                  user=Depends(require("api:preset.write", "create"))):
    _catalogue_ecrivable(user)
    if not SLUG_VALIDE.match(body.slug):
        raise HTTPException(400, "Slug attendu en minuscules séparées par des tirets")
    if db.execute(select(CompositionPreset)
                  .where(CompositionPreset.slug == body.slug)).scalar_one_or_none():
        raise HTTPException(409, f"Le préset {body.slug} existe déjà")

    preset = CompositionPreset(
        slug=body.slug, nom=body.nom, constructeur=body.constructeur,
        famille=body.famille, description=body.description, spec=body.spec,
        ordre=body.ordre, notes=body.notes, created_by=user.id,
    )
    db.add(preset)
    db.commit()
    db.refresh(preset)
    write_audit(db, actor=user, action="PRESET_CREATE",
                resource=f"{preset.nom} ({preset.famille})")
    db.commit()
    return preset


@router.post("/from-version/{version_id}", response_model=CompositionPresetOut, status_code=201)
def promote_version(version_id: str, body: CompositionPresetIn, db: Session = Depends(get_db),
                    user=Depends(require("api:preset.write", "create"))):
    """Promeut une version de bundle publiée en préset du catalogue.

    C'est le chemin par lequel la bibliothèque s'enrichit : on compose et on
    éprouve sur un robot réel, puis on verse au catalogue ce qui a fait ses
    preuves. Une version encore en brouillon est refusée — un point de départ
    proposé à tous doit d'abord avoir été figé.
    """
    _catalogue_ecrivable(user)
    version = db.get(BundleVersion, version_id)
    if version is None:
        raise HTTPException(404, "Version de bundle inconnue")
    if version.statut != "published":
        raise HTTPException(409, "Seule une version publiée peut devenir un préset")
    if db.execute(select(CompositionPreset)
                  .where(CompositionPreset.slug == body.slug)).scalar_one_or_none():
        raise HTTPException(409, f"Le préset {body.slug} existe déjà")

    bundle = db.get(DeploymentBundle, version.bundle_id)
    preset = CompositionPreset(
        slug=body.slug,
        nom=body.nom or (bundle.nom if bundle else body.slug),
        constructeur=body.constructeur,
        famille=body.famille,
        description=body.description or (bundle.description if bundle else None),
        spec=dict(version.spec or {}),
        ordre=body.ordre,
        notes=body.notes,
        created_by=user.id,
    )
    db.add(preset)
    db.commit()
    db.refresh(preset)
    write_audit(db, actor=user, action="PRESET_PROMOTE",
                resource=f"{preset.nom} ← version {version.numero}")
    db.commit()
    return preset


@router.patch("/{reference}", response_model=CompositionPresetOut)
def update_preset(reference: str, body: CompositionPresetPatch, db: Session = Depends(get_db),
                  user=Depends(require("api:preset.write", "update"))):
    """Corrige un préset. Il reste le même préset, sa révision avance."""
    _catalogue_ecrivable(user)
    preset = _preset(db, reference)
    champs = body.model_dump(exclude_unset=True)
    if "statut" in champs and champs["statut"] not in STATUTS:
        raise HTTPException(400, f"Statut inconnu : {champs['statut']}")
    touche_le_fond = any(c in champs for c in ("spec", "famille"))
    for cle, valeur in champs.items():
        setattr(preset, cle, valeur)
    if touche_le_fond:
        preset.revision += 1
    preset.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(preset)
    write_audit(db, actor=user, action="PRESET_UPDATE",
                resource=f"{preset.nom} (révision {preset.revision})")
    db.commit()
    return preset


@router.delete("/{reference}", status_code=204)
def delete_preset(reference: str, db: Session = Depends(get_db),
                  user=Depends(require("api:preset.write", "delete"))):
    """Retire un préset du catalogue.

    L'archivage est préféré à la suppression partout où un préset a pu servir
    de point de départ : les projets déjà créés en gardent une copie, mais la
    trace de ce qui a été proposé a une valeur.
    """
    _catalogue_ecrivable(user)
    preset = _preset(db, reference)
    nom = preset.nom
    db.delete(preset)
    db.commit()
    write_audit(db, actor=user, action="PRESET_DELETE", resource=nom)
    db.commit()
